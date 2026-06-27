import os
import sys
import time

# Add local libs folder to sys.path so we load packages installed with -t (if any)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'libs'))

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import psycopg2
from psycopg2 import extras

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

if __name__ == '__main__':
    # Ensure static directory exists
    os.makedirs(static_folder, exist_ok=True)
    
    PORT = 5000
    print(f"SQL Pro backend running on http://localhost:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=True)
