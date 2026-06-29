import os
import time
import logging
import threading
import google.generativeai as genai
import chromadb

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("RAGEngine")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.path.join(BASE_DIR, ".chroma_data")

# Global status tracking
indexing_status = "idle"  # "idle", "indexing", "synced", "failed"
indexing_error = ""

class RAGEngine:
    def __init__(self):
        self.chroma_client = None
        self.collection = None
        self._init_chroma()
        self.api_configured = False
        self.embedding_model = "models/gemini-embedding-2"
        self.generation_model = "models/gemini-2.5-flash"
        self._configure_gemini()

    def _init_chroma(self):
        try:
            logger.info(f"Initializing ChromaDB client at path: {CHROMA_PATH}")
            self.chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)
            # Create or get the collection
            self.collection = self.chroma_client.get_or_create_collection(
                name="sql_pro_collection",
                metadata={"hnsw:space": "cosine"} # cosine distance for semantic similarity
            )
            logger.info("ChromaDB initialized successfully.")
        except Exception as e:
            logger.error(f"Error initializing ChromaDB: {e}")

    def _configure_gemini(self):
        # Load API Key from environment or check if already configured
        api_key = os.getenv("GEMINI_API_KEY")
        if api_key:
            try:
                genai.configure(api_key=api_key)
                self.api_configured = True
                logger.info("Gemini API configured successfully from env.")
                
                # Resolve models dynamically
                try:
                    available_models = [m.name for m in genai.list_models()]
                    # Resolve generation model
                    for candidate in ['models/gemini-3.5-flash', 'models/gemini-2.5-flash', 'models/gemini-2.0-flash', 'models/gemini-flash-latest', 'models/gemini-1.5-flash', 'models/gemini-pro']:
                        if candidate in available_models:
                            self.generation_model = candidate
                            break
                    else:
                        self.generation_model = 'models/gemini-flash-latest'
                        
                    # Resolve embedding model
                    for candidate in ['models/gemini-embedding-2', 'models/gemini-embedding-001', 'models/text-embedding-004']:
                        if candidate in available_models:
                            self.embedding_model = candidate
                            break
                    else:
                        self.embedding_model = 'models/gemini-embedding-2'
                        
                    logger.info(f"Auto-resolved models: Gen={self.generation_model}, Embed={self.embedding_model}")
                except Exception as list_err:
                    logger.warning(f"Could not list models during configure: {list_err}")
            except Exception as e:
                logger.error(f"Failed to configure Gemini API: {e}")
                self.api_configured = False
        else:
            logger.warning("GEMINI_API_KEY environment variable not found.")
            self.api_configured = False

    def update_api_key(self, api_key):
        if api_key:
            try:
                genai.configure(api_key=api_key)
                self.api_configured = True
                # Persist key in environment so child threads see it
                os.environ["GEMINI_API_KEY"] = api_key
                logger.info("Gemini API Key updated successfully.")
                
                # Resolve models dynamically
                try:
                    available_models = [m.name for m in genai.list_models()]
                    for candidate in ['models/gemini-3.5-flash', 'models/gemini-2.5-flash', 'models/gemini-2.0-flash', 'models/gemini-flash-latest', 'models/gemini-1.5-flash', 'models/gemini-pro']:
                        if candidate in available_models:
                            self.generation_model = candidate
                            break
                    else:
                        self.generation_model = 'models/gemini-flash-latest'
                        
                    for candidate in ['models/gemini-embedding-2', 'models/gemini-embedding-001', 'models/text-embedding-004']:
                        if candidate in available_models:
                            self.embedding_model = candidate
                            break
                    else:
                        self.embedding_model = 'models/gemini-embedding-2'
                        
                    logger.info(f"Auto-resolved models on key update: Gen={self.generation_model}, Embed={self.embedding_model}")
                except Exception as list_err:
                    logger.warning(f"Could not list models during key update: {list_err}")
                return True
            except Exception as e:
                logger.error(f"Failed to update Gemini API Key: {e}")
        return False

    def _get_embedding(self, texts, is_query=False):
        """
        Calls Gemini Embeddings API with automatic retry and backoff on rate limits.
        """
        if not self.api_configured:
            # Check env variable one more time in case it was set by parent thread
            self._configure_gemini()
            if not self.api_configured:
                raise ValueError("Gemini API Key is not configured. Please add GEMINI_API_KEY to your environment/settings.")

        task_type = "retrieval_query" if is_query else "retrieval_document"
        
        max_retries = 5
        backoff_factor = 2
        initial_delay = 2.0  # seconds

        for attempt in range(max_retries):
            try:
                result = genai.embed_content(
                    model=self.embedding_model,
                    content=texts,
                    task_type=task_type
                )
                # Response formatting varies depending on input type (single vs list)
                if isinstance(texts, str):
                    return result['embedding']
                else:
                    return result['embedding']
            except Exception as e:
                error_msg = str(e)
                # Check for rate limit or quota exceeded exceptions (HTTP 429 or status ResourceExhausted)
                if "429" in error_msg or "Quota exceeded" in error_msg or "ResourceExhausted" in error_msg:
                    delay = initial_delay * (backoff_factor ** attempt)
                    logger.warning(f"Rate limit hit during embedding. Retrying in {delay:.1f} seconds... (Attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
                else:
                    logger.error(f"Error generating embeddings from Gemini using {self.embedding_model}: {e}")
                    raise e
        
        raise Exception("Max retries exceeded for generating embeddings due to Gemini API rate limits.")

    def ingest_table_data(self, conn, table_name):
        """
        Indexes a single table's schema and up to 1000 rows.
        First clears previous documents for this table in ChromaDB.
        """
        if not self.collection:
            logger.error("ChromaDB collection is not available.")
            return

        try:
            logger.info(f"Ingesting table: {table_name}")
            # 1. Fetch Columns
            with conn.cursor() as cursor:
                cursor.execute(
                    """SELECT column_name, data_type, is_nullable, column_default
                       FROM information_schema.columns 
                       WHERE table_name = %s AND table_schema = 'public'
                       ORDER BY ordinal_position;""",
                    (table_name,)
                )
                columns = cursor.fetchall()
                col_names = [col[0] for col in columns]

            # 2. Fetch rows (Limit to 1000 to prevent token/memory limits)
            with conn.cursor() as cursor:
                # Quoted table name to handle mixed cases safely
                cursor.execute(f'SELECT * FROM "{table_name}" LIMIT 1000;')
                rows = cursor.fetchall()

            chunks = []
            metadatas = []
            ids = []

            # 3. Create Schema Chunk
            schema_desc = f"Schema for Table: {table_name}. Columns: "
            col_parts = []
            for col in columns:
                col_desc = f"{col[0]} ({col[1]}"
                if col[2] == 'NO':
                    col_desc += ", NOT NULL"
                if col[3]:
                    col_desc += f", DEFAULT {col[3]}"
                col_desc += ")"
                col_parts.append(col_desc)
            schema_desc += ", ".join(col_parts)
            
            chunks.append(schema_desc)
            metadatas.append({"table_name": table_name, "type": "schema"})
            ids.append(f"schema_{table_name}")

            # 4. Create Row Chunks
            for idx, row in enumerate(rows):
                row_parts = []
                for col_idx, col_val in enumerate(row):
                    col_name = col_names[col_idx]
                    if col_val is None:
                        val_str = "null"
                    else:
                        val_str = str(col_val)
                    row_parts.append(f"{col_name}={val_str}")
                
                row_desc = f"Table: {table_name} | Record: " + ", ".join(row_parts)
                chunks.append(row_desc)
                metadatas.append({"table_name": table_name, "type": "row", "row_index": idx})
                ids.append(f"row_{table_name}_{idx}")

            # 5. Delete existing indexes for this table
            try:
                self.collection.delete(where={"table_name": table_name})
            except Exception as delete_err:
                logger.warning(f"Error deleting old records for {table_name} (might not exist yet): {delete_err}")

            # 6. Generate embeddings and save to Chroma (batch to avoid exceeding API limits)
            batch_size = 200
            for i in range(0, len(chunks), batch_size):
                batch_chunks = chunks[i:i + batch_size]
                batch_metadatas = metadatas[i:i + batch_size]
                batch_ids = ids[i:i + batch_size]
 
                # Fetch embeddings from Gemini API
                batch_embeddings = self._get_embedding(batch_chunks)
 
                # Add to ChromaDB
                self.collection.add(
                    ids=batch_ids,
                    embeddings=batch_embeddings,
                    documents=batch_chunks,
                    metadatas=batch_metadatas
                )
                # Small pacing delay to respect free-tier API rate limits
                time.sleep(0.5)
            
            logger.info(f"Successfully indexed table {table_name} ({len(chunks)} chunks).")

        except Exception as e:
            logger.error(f"Failed to ingest table {table_name}: {e}")
            raise e

    def ingest_database(self, conn):
        """
        Runs full database schema and data ingestion in a background task.
        """
        global indexing_status, indexing_error
        indexing_status = "indexing"
        indexing_error = ""
        
        try:
            logger.info("Starting database ingestion process...")
            
            # Fetch all public tables
            with conn.cursor() as cursor:
                cursor.execute(
                    """SELECT table_name 
                       FROM information_schema.tables 
                       WHERE table_schema = 'public' 
                       AND table_type = 'BASE TABLE'
                       ORDER BY table_name;"""
                )
                tables = [row[0] for row in cursor.fetchall()]

            if not tables:
                logger.info("No tables found in public schema to index.")
                indexing_status = "synced"
                return

            # Clear all current collection data
            try:
                # Retrieve all IDs in the collection
                all_data = self.collection.get()
                if all_data and all_data['ids']:
                    self.collection.delete(ids=all_data['ids'])
            except Exception as clear_err:
                logger.warning(f"Error resetting collection: {clear_err}")

            # Index each table
            for table_name in tables:
                self.ingest_table_data(conn, table_name)

            indexing_status = "synced"
            logger.info("Database ingestion completed. ChromaDB fully synced.")

        except Exception as e:
            indexing_status = "failed"
            indexing_error = str(e)
            logger.error(f"Database ingestion failed: {e}")

    def query_context(self, query_text, limit=10):
        """
        Queries ChromaDB for relevant text chunks.
        """
        if not self.collection:
            return []

        try:
            # 1. Embed query
            query_vector = self._get_embedding(query_text, is_query=True)

            # 2. Search ChromaDB
            results = self.collection.query(
                query_embeddings=[query_vector],
                n_results=limit
            )

            # Format documents returned
            retrieved_docs = []
            if results and 'documents' in results and results['documents']:
                for doc_list in results['documents']:
                    for doc in doc_list:
                        retrieved_docs.append(doc)
            return retrieved_docs

        except Exception as e:
            logger.error(f"Error querying context: {e}")
            return []

    def get_chat_response(self, user_query, active_db_name="postgres", all_databases=None):
        """
        Sends context and user query to Gemini to generate final response.
        """
        if not self.api_configured:
            return "Please configure your Gemini API Key in the settings/environment first."

        try:
            # 1. Retrieve matching chunks from ChromaDB
            context_chunks = self.query_context(user_query, limit=12)
            
            # Format context string
            context_str = "\n".join([f"- {doc}" for doc in context_chunks])

            # Format database list metadata
            db_metadata_str = f"Active connected database: '{active_db_name}'\n"
            if all_databases:
                db_metadata_str += f"Total databases count: {len(all_databases)}\n"
                db_metadata_str += "All database names present on PostgreSQL server:\n"
                db_metadata_str += "\n".join([f"- {db}" for db in all_databases])
            else:
                db_metadata_str += "PostgreSQL database list: Unavailable (not connected or query failed)"

            # 2. Build system instructions and prompt
            prompt = f"""You are a helpful, premium database assistant integrated into SQL Pro Web.
You are helping the user manage their PostgreSQL database instance.

=== LIVE SERVER METADATA ===
{db_metadata_str}
=== END OF LIVE SERVER METADATA ===

Here is the relevant data retrieved from the active database schema and tables via RAG (Vector Search):
=== RETRIEVED DATABASE CONTEXT ===
{context_str if context_chunks else "(No matching records found in database)"}
=== END OF CONTEXT ===

User Question: {user_query}

Instructions:
- Provide an accurate, helpful, and natural language response.
- Use the LIVE SERVER METADATA to answer questions about the active database name, total databases, their counts, and database names.
- If the user asks "what database am I in?", "which database is active?", "how many databases are present?", or "what are the database names?", answer directly and list/count them using the LIVE SERVER METADATA.
- If they ask about tables, columns, or rows in the database, use the RETRIEVED DATABASE CONTEXT.
- If the data is present, format it beautifully using markdown tables, bullet points, or bold text.
- Keep your answers clean, professional, and descriptive.
"""

            # 3. Create model using resolved name
            model = genai.GenerativeModel(self.generation_model)
            response = model.generate_content(prompt)
            return response.text

        except Exception as e:
            logger.error(f"Error generating chat response: {e}")
            return f"Error generating response: {str(e)}"

# Global engine instance
rag_engine = RAGEngine()
