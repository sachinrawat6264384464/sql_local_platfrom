import os
import sys
import time
import threading

# Add local libs folder to sys.path so we load packages installed with -t (if any)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'libs'))

# Load dotenv to get GEMINI_API_KEY
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import psycopg2
from psycopg2 import extras
from rag_engine import rag_engine

base_dir = os.path.dirname(os.path.abspath(__file__))
static_folder = os.path.join(base_dir, 'static')

app = Flask(__name__, static_folder=static_folder)
CORS(app)

active_conn = None
active_config = None

def disconnect_active_conn():
    global active_conn
    if active_conn:
        try:
            active_conn.close()
        except Exception as e:
            print("Error disconnecting active connection:", e)
        active_conn = None

# Serve Frontend Static Files
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)

# POST: Connect to PostgreSQL server
@app.route('/api/connect', methods=['POST'])
def connect():
    global active_conn, active_config
    data = request.json or {}
    host = data.get('host')
    port = data.get('port')
    user = data.get('user')
    password = data.get('password')
    database = data.get('database') or 'postgres'

    if not host or not port or not user:
        return jsonify({'error': 'Host, port, and username are required.'}), 400

    try:
        disconnect_active_conn()

        config = {
            'host': host,
            'port': int(port),
            'user': user,
            'password': password,
            'database': database
        }

        # Connect to PostgreSQL
        conn = psycopg2.connect(
            host=config['host'],
            port=config['port'],
            user=config['user'],
            password=config['password'],
            database=config['database'],
            connect_timeout=5
        )
        conn.autocommit = True  # Enable autocommit for instant DDL/DML execution

        active_conn = conn
        active_config = config

        # Trigger background RAG database indexing
        try:
            threading.Thread(target=rag_engine.ingest_database, args=(conn,), daemon=True).start()
        except Exception as thread_err:
            print("Error starting ingestion thread:", thread_err)

        return jsonify({
            'message': 'Successfully connected to PostgreSQL!',
            'database': database
        })
    except Exception as e:
        active_conn = None
        active_config = None
        return jsonify({'error': str(e)}), 400

# POST: Switch Active Database
@app.route('/api/switch-database', methods=['POST'])
def switch_database():
    global active_conn, active_config
    if not active_config:
        return jsonify({'error': 'No active connection. Please connect first.'}), 401

    data = request.json or {}
    database = data.get('database')

    if not database:
        return jsonify({'error': 'Database name is required.'}), 400

    try:
        disconnect_active_conn()

        new_config = active_config.copy()
        new_config['database'] = database

        conn = psycopg2.connect(
            host=new_config['host'],
            port=new_config['port'],
            user=new_config['user'],
            password=new_config['password'],
            database=new_config['database'],
            connect_timeout=5
        )
        conn.autocommit = True

        active_conn = conn
        active_config = new_config

        # Trigger background RAG database indexing
        try:
            threading.Thread(target=rag_engine.ingest_database, args=(conn,), daemon=True).start()
        except Exception as thread_err:
            print("Error starting switch ingestion thread:", thread_err)

        return jsonify({
            'message': f'Successfully switched to database "{database}"',
            'database': database
        })
    except Exception as e:
        # Reconnect to previous database if switch fails
        print(f"Failed to switch database: {e}. Reconnecting to previous database...")
        try:
            conn = psycopg2.connect(
                host=active_config['host'],
                port=active_config['port'],
                user=active_config['user'],
                password=active_config['password'],
                database=active_config['database']
            )
            conn.autocommit = True
            active_conn = conn
        except Exception as reconnect_err:
            active_conn = None
            active_config = None
        return jsonify({'error': f'Failed to switch database: {str(e)}'}), 400

# GET: Connection Status Check
@app.route('/api/status', methods=['GET'])
def get_status():
    global active_conn, active_config
    if active_conn and active_config:
        return jsonify({
            'connected': True,
            'config': {
                'host': active_config['host'],
                'port': active_config['port'],
                'user': active_config['user'],
                'database': active_config['database']
            }
        })
    return jsonify({'connected': False})

# GET: List Databases
@app.route('/api/databases', methods=['GET'])
def get_databases():
    global active_conn
    if not active_conn:
        return jsonify({'error': 'Not connected to database.'}), 401

    try:
        with active_conn.cursor() as cursor:
            cursor.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;")
            databases = [row[0] for row in cursor.fetchall()]
        return jsonify({'databases': databases})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# GET: List Tables
@app.route('/api/tables', methods=['GET'])
def get_tables():
    global active_conn
    if not active_conn:
        return jsonify({'error': 'Not connected to database.'}), 401

    try:
        with active_conn.cursor() as cursor:
            cursor.execute(
                """SELECT table_name 
                   FROM information_schema.tables 
                   WHERE table_schema = 'public' 
                   AND table_type = 'BASE TABLE'
                   ORDER BY table_name;"""
            )
            tables = [row[0] for row in cursor.fetchall()]
        return jsonify({'tables': tables})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# GET: Table Column Schema & first 100 Rows
@app.route('/api/table-data/<tableName>', methods=['GET'])
def get_table_data(tableName):
    global active_conn
    if not active_conn:
        return jsonify({'error': 'Not connected to database.'}), 401

    try:
        # Validate table exists in public schema to prevent SQL injection
        with active_conn.cursor() as cursor:
            cursor.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = %s;",
                (tableName,)
            )
            if not cursor.fetchone():
                return jsonify({'error': f'Table "{tableName}" not found.'}), 404

            # Get column definitions
            cursor.execute(
                """SELECT column_name, data_type, is_nullable, column_default
                   FROM information_schema.columns 
                   WHERE table_name = %s AND table_schema = 'public'
                   ORDER BY ordinal_position;""",
                (tableName,)
            )
            columns = [
                {
                    'column_name': row[0],
                    'data_type': row[1],
                    'is_nullable': row[2],
                    'column_default': row[3]
                }
                for row in cursor.fetchall()
            ]

        # Get rows (using RealDictCursor to return dicts instead of tuples)
        with active_conn.cursor(cursor_factory=extras.RealDictCursor) as dict_cursor:
            # Safely quote table name to support mixed-case names
            dict_cursor.execute(f'SELECT * FROM "{tableName}" LIMIT 100;')
            rows = dict_cursor.fetchall()

        return jsonify({
            'columns': columns,
            'rows': rows,
            'rowCount': len(rows)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# POST: Execute Arbitrary SQL Query
@app.route('/api/query', methods=['POST'])
def execute_query():
    global active_conn
    if not active_conn:
        return jsonify({'error': 'Not connected to database.'}), 401

    data = request.json or {}
    sql = data.get('sql')

    if not sql or sql.strip() == '':
        return jsonify({'error': 'SQL query cannot be empty.'}), 400

    start_time = time.time()
    try:
        with active_conn.cursor(cursor_factory=extras.RealDictCursor) as dict_cursor:
            dict_cursor.execute(sql)
            duration_ms = int((time.time() - start_time) * 1000)

            # Check if query returned rows
            has_description = dict_cursor.description is not None
            rows = dict_cursor.fetchall() if has_description else []

            fields = []
            if has_description:
                fields = [{'name': desc.name, 'type_code': desc.type_code} for desc in dict_cursor.description]

            result_obj = {
                'command': dict_cursor.statusmessage or 'SELECT',
                'rowCount': dict_cursor.rowcount,
                'rows': rows,
                'fields': fields
            }

        # Check if mutation query, if so re-index database
        sql_upper = sql.upper().strip()
        if any(keyword in sql_upper for keyword in ["INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER"]):
            try:
                threading.Thread(target=rag_engine.ingest_database, args=(active_conn,), daemon=True).start()
            except Exception as thread_err:
                print("Error starting query-triggered re-indexing thread:", thread_err)

        return jsonify({
            'success': True,
            'results': [result_obj],
            'duration': f"{duration_ms}ms"
        })
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return jsonify({
            'success': False,
            'error': str(e),
            'duration': f"{duration_ms}ms"
        }), 400

# GET: Fetch database schema relations (for ER diagram)
@app.route('/api/relationships', methods=['GET'])
def get_relationships():
    global active_conn
    if not active_conn:
        return jsonify({'error': 'Not connected to database.'}), 401

    try:
        # 1. Fetch all columns of all public tables
        with active_conn.cursor() as cursor:
            cursor.execute(
                """SELECT table_name, column_name, data_type 
                   FROM information_schema.columns 
                   WHERE table_schema = 'public' 
                   ORDER BY table_name, ordinal_position;"""
            )
            columns_raw = cursor.fetchall()
            
            tables = {}
            for row in columns_raw:
                t_name, c_name, d_type = row
                if t_name not in tables:
                    tables[t_name] = []
                tables[t_name].append({'name': c_name, 'type': d_type})

            # 2. Fetch all foreign keys
            cursor.execute(
                """SELECT
                       tc.table_name AS source_table,
                       kcu.column_name AS source_column,
                       ccu.table_name AS target_table,
                       ccu.column_name AS target_column
                   FROM
                       information_schema.table_constraints AS tc
                       JOIN information_schema.key_column_usage AS kcu
                         ON tc.constraint_name = kcu.constraint_name
                         AND tc.table_schema = kcu.table_schema
                       JOIN information_schema.constraint_column_usage AS ccu
                         ON ccu.constraint_name = tc.constraint_name
                         AND ccu.table_schema = tc.table_schema
                   WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';"""
            )
            fkeys_raw = cursor.fetchall()
            
            relationships = []
            for row in fkeys_raw:
                relationships.append({
                    'source_table': row[0],
                    'source_column': row[1],
                    'target_table': row[2],
                    'target_column': row[3]
                })

        return jsonify({
            'tables': tables,
            'relationships': relationships
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# POST: AI Chat endpoint using RAG
@app.route('/api/chat', methods=['POST'])
def chat():
    global active_conn, active_config
    data = request.json or {}
    message = data.get('message')
    api_key = data.get('api_key') # Option to receive API key from front-end

    if not message or message.strip() == '':
        return jsonify({'error': 'Message cannot be empty.'}), 400

    # If key was sent from client, dynamically set it
    if api_key:
        rag_engine.update_api_key(api_key)

    active_db = active_config.get('database', 'postgres') if active_config else 'postgres'
    
    # Query database list dynamically from the active connection
    all_dbs = []
    if active_conn:
        try:
            # If the current transaction is aborted, rollback first to keep it clean
            try:
                active_conn.rollback()
            except:
                pass
            with active_conn.cursor() as cursor:
                cursor.execute("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;")
                all_dbs = [row[0] for row in cursor.fetchall()]
        except Exception as query_err:
            print(f"Error querying database list: {query_err}")
    
    # Diagnostic logging to status_log.txt
    try:
        import rag_engine as re_module
        with open('status_log.txt', 'w', encoding='utf-8') as sf:
            sf.write(f"Active DB: {active_db}\n")
            sf.write(f"RAG Status: {re_module.indexing_status}\n")
            sf.write(f"RAG Error: {re_module.indexing_error}\n")
            sf.write(f"API Configured: {rag_engine.api_configured}\n")
            if rag_engine.collection:
                sf.write(f"Chroma Count: {rag_engine.collection.count()}\n")
                try:
                    sample = rag_engine.collection.get(limit=10)
                    sf.write(f"Chroma Sample Metadatas: {sample['metadatas']}\n")
                except Exception as get_err:
                    sf.write(f"Chroma Get Error: {get_err}\n")
            else:
                sf.write("Chroma Collection: None\n")
    except Exception as sf_err:
        print(f"Error writing status log: {sf_err}")

    # Generate RAG response
    response_text = rag_engine.get_chat_response(message, active_db_name=active_db, all_databases=all_dbs)
    return jsonify({'response': response_text})

# GET: Check RAG Indexing status
@app.route('/api/rag/status', methods=['GET'])
def get_rag_status():
    import rag_engine as re_module
    return jsonify({
        'status': re_module.indexing_status,
        'error': re_module.indexing_error,
        'api_configured': rag_engine.api_configured
    })

# POST: Save/update Gemini API Key in backend session
@app.route('/api/rag/config', methods=['POST'])
def save_rag_config():
    data = request.json or {}
    api_key = data.get('api_key')
    if not api_key:
        return jsonify({'error': 'API key is required.'}), 400
    
    success = rag_engine.update_api_key(api_key)
    if success:
        return jsonify({'success': True, 'message': 'API Key successfully configured.'})
    else:
        return jsonify({'error': 'Failed to configure API key.'}), 400

def get_all_tables_schema_text(conn):
    try:
        # If the transaction is aborted, roll back first to keep it clean
        try:
            conn.rollback()
        except:
            pass
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT table_name 
                   FROM information_schema.tables 
                   WHERE table_schema = 'public' 
                   AND table_type = 'BASE TABLE'
                   ORDER BY table_name;"""
            )
            tables = [row[0] for row in cursor.fetchall()]
            
            schema_parts = []
            for t in tables:
                cursor.execute(
                    """SELECT column_name, data_type, is_nullable
                       FROM information_schema.columns 
                       WHERE table_name = %s AND table_schema = 'public'
                       ORDER BY ordinal_position;""",
                    (t,)
                )
                columns = cursor.fetchall()
                col_descs = [f"{col[0]} ({col[1]}, nullable={col[2]})" for col in columns]
                schema_parts.append(f"Table: {t}\nColumns: {', '.join(col_descs)}")
            return "\n\n".join(schema_parts)
    except Exception as e:
        print(f"Error getting schema text: {e}")
        return ""

# POST: Translate natural language prompt to SQL query
@app.route('/api/ai/nl2sql', methods=['POST'])
def ai_nl2sql():
    global active_conn, active_config
    if not active_conn:
        return jsonify({'error': 'No active database connection. Please connect first.'}), 401
    
    data = request.json or {}
    prompt = data.get('prompt')
    if not prompt:
        return jsonify({'error': 'Prompt is required.'}), 400
        
    active_db = active_config.get('database', 'postgres') if active_config else 'postgres'
    
    try:
        schema_text = get_all_tables_schema_text(active_conn)
        sql = rag_engine.generate_nl2sql(prompt, active_db=active_db, table_schemas=schema_text)
        return jsonify({'sql': sql})
    except Exception as e:
        import traceback
        try:
            with open('nl2sql_error.txt', 'w', encoding='utf-8') as ef:
                ef.write(traceback.format_exc())
        except Exception as f_err:
            print(f"Error writing to nl2sql_error.txt: {f_err}")
        return jsonify({'error': f"Failed to generate SQL: {str(e)}"}), 500

# POST: Generate and insert 100 rows of mock data
@app.route('/api/ai/mock-data', methods=['POST'])
def ai_mock_data():
    global active_conn
    if not active_conn:
        return jsonify({'error': 'No active database connection.'}), 401
        
    data = request.json or {}
    table_name = data.get('table')
    if not table_name:
        return jsonify({'error': 'Table name is required.'}), 400
        
    try:
        try:
            active_conn.rollback()
        except:
            pass
        with active_conn.cursor() as cursor:
            cursor.execute(
                """SELECT column_name, data_type, is_nullable
                   FROM information_schema.columns 
                   WHERE table_name = %s AND table_schema = 'public'
                   ORDER BY ordinal_position;""",
                (table_name,)
            )
            columns = cursor.fetchall()
            if not columns:
                return jsonify({'error': f"Table '{table_name}' does not exist or has no columns."}), 404
                
            columns_info = [{'name': col[0], 'type': col[1], 'nullable': col[2]} for col in columns]
            
            # Generate the mock data insert statement
            insert_sql = rag_engine.generate_mock_data(table_name, columns_info)
            
            # Execute the generated inserts
            cursor.execute(insert_sql)
            active_conn.commit()
            
            return jsonify({'success': True, 'message': f"Successfully generated and inserted 20 mock rows into '{table_name}'."})
    except Exception as e:
        import traceback
        try:
            with open('mock_error.txt', 'w', encoding='utf-8') as ef:
                ef.write(traceback.format_exc())
        except Exception as f_err:
            print(f"Error writing to mock_error.txt: {f_err}")
        try:
            active_conn.rollback()
        except:
            pass
        return jsonify({'error': f"Failed to generate mock data: {str(e)}"}), 500

# POST: Optimize a SQL query
@app.route('/api/ai/optimize', methods=['POST'])
def ai_optimize():
    global active_conn, active_config
    if not active_conn:
        return jsonify({'error': 'No active database connection.'}), 401
        
    data = request.json or {}
    sql_query = data.get('sql')
    if not sql_query:
        return jsonify({'error': 'SQL query is required.'}), 400
        
    active_db = active_config.get('database', 'postgres') if active_config else 'postgres'
    
    try:
        schema_text = get_all_tables_schema_text(active_conn)
        result = rag_engine.optimize_query(sql_query, active_db=active_db, table_schemas=schema_text)
        return jsonify(result)
    except Exception as e:
        import traceback
        try:
            with open('optimize_error.txt', 'w', encoding='utf-8') as ef:
                ef.write(traceback.format_exc())
        except Exception as f_err:
            print(f"Error writing to optimize_error.txt: {f_err}")
        return jsonify({'error': f"Failed to optimize query: {str(e)}"}), 500

if __name__ == '__main__':
    # Ensure static directory exists
    os.makedirs(static_folder, exist_ok=True)
    
    PORT = 5000
    print(f"SQL Pro backend running on http://localhost:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=True)
