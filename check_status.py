import os
import sys

# Ensure local libs folder is searched first
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'libs'))

import rag_engine as re_module

print(f"Indexing Status: {re_module.indexing_status}")
print(f"Indexing Error: {re_module.indexing_error}")

try:
    if re_module.rag_engine.collection:
        count = re_module.rag_engine.collection.count()
        print(f"Total documents in ChromaDB: {count}")
        if count > 0:
            sample = re_module.rag_engine.collection.get(limit=5)
            print("\nSample Documents:")
            for doc, meta in zip(sample['documents'], sample['metadatas']):
                print(f"- [{meta.get('type')}] {doc[:100]}...")
    else:
        print("ChromaDB Collection is not initialized.")
except Exception as e:
    print(f"Error checking ChromaDB: {e}")
