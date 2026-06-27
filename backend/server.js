const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

let activeClient = null;
let activeConfig = null;

// Helper function to disconnect current client
async function disconnectActiveClient() {
  if (activeClient) {
    try {
      await activeClient.end();
    } catch (err) {
      console.error('Error disconnecting active client:', err);
    }
    activeClient = null;
  }
}

// POST: Connect to PostgreSQL server
app.post('/api/connect', async (req, res) => {
  const { host, port, user, password, database } = req.body;

  if (!host || !port || !user) {
    return res.status(400).json({ error: 'Host, port, and username are required.' });
  }

  try {
    await disconnectActiveClient();

    const config = {
      host,
      port: parseInt(port),
      user,
      password,
      database: database || 'postgres', // default to postgres
      connectionTimeoutMillis: 5000
    };

    const client = new Client(config);
    await client.connect();

    activeClient = client;
    activeConfig = config;

    res.json({
      message: 'Successfully connected to PostgreSQL!',
      database: config.database
    });
  } catch (err) {
    activeClient = null;
    activeConfig = null;
    res.status(400).json({ error: err.message });
  }
});

// POST: Switch database
app.post('/api/switch-database', async (req, res) => {
  const { database } = req.body;

  if (!activeConfig) {
    return res.status(401).json({ error: 'No active connection. Please connect first.' });
  }

  if (!database) {
    return res.status(400).json({ error: 'Database name is required.' });
  }

  try {
    await disconnectActiveClient();

    const newConfig = { ...activeConfig, database };
    const client = new Client(newConfig);
    await client.connect();

    activeClient = client;
    activeConfig = newConfig;

    res.json({
      message: `Successfully switched to database "${database}"`,
      database
    });
  } catch (err) {
    // If connection to new database fails, try to reconnect to old database
    console.error(`Failed to switch database: ${err.message}. Reconnecting to previous database...`);
    try {
      const client = new Client(activeConfig);
      await client.connect();
      activeClient = client;
    } catch (reconnectErr) {
      activeClient = null;
      activeConfig = null;
    }
    res.status(400).json({ error: `Failed to switch database: ${err.message}` });
  }
});

// GET: Check connection status
app.get('/api/status', (req, res) => {
  if (activeClient && activeConfig) {
    res.json({
      connected: true,
      config: {
        host: activeConfig.host,
        port: activeConfig.port,
        user: activeConfig.user,
        database: activeConfig.database
      }
    });
  } else {
    res.json({ connected: false });
  }
});

// GET: List all databases
app.get('/api/databases', async (req, res) => {
  if (!activeClient) {
    return res.status(401).json({ error: 'Not connected to database.' });
  }

  try {
    const result = await activeClient.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;"
    );
    const databases = result.rows.map(row => row.datname);
    res.json({ databases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: List all tables in current database
app.get('/api/tables', async (req, res) => {
  if (!activeClient) {
    return res.status(401).json({ error: 'Not connected to database.' });
  }

  try {
    const result = await activeClient.query(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_type = 'BASE TABLE'
       ORDER BY table_name;`
    );
    const tables = result.rows.map(row => row.table_name);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Table columns & data (first 100 rows)
app.get('/api/table-data/:tableName', async (req, res) => {
  const { tableName } = req.params;

  if (!activeClient) {
    return res.status(401).json({ error: 'Not connected to database.' });
  }

  try {
    // 1. Validate table exists in public schema to prevent SQL injection
    const checkTable = await activeClient.query(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_name = $1;`,
      [tableName]
    );

    if (checkTable.rows.length === 0) {
      return res.status(404).json({ error: `Table "${tableName}" not found.` });
    }

    // 2. Get column metadata
    const columnsResult = await activeClient.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns 
       WHERE table_name = $1 AND table_schema = 'public'
       ORDER BY ordinal_position;`,
      [tableName]
    );

    // 3. Get table rows (up to 100)
    // Double quotes around tableName in query to handle mixed-case table names safely
    const dataResult = await activeClient.query(`SELECT * FROM "${tableName}" LIMIT 100;`);

    res.json({
      columns: columnsResult.rows,
      rows: dataResult.rows,
      rowCount: dataResult.rowCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Execute custom query
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;

  if (!activeClient) {
    return res.status(401).json({ error: 'Not connected to database.' });
  }

  if (!sql || sql.trim() === '') {
    return res.status(400).json({ error: 'SQL query cannot be empty.' });
  }

  const startTime = Date.now();

  try {
    const result = await activeClient.query(sql);
    const duration = Date.now() - startTime;

    // pg client returns an array of results if there are multiple queries separated by semicolons
    const resultsArray = Array.isArray(result) ? result : [result];

    const formattedResults = resultsArray.map(resObj => {
      return {
        command: resObj.command,
        rowCount: resObj.rowCount,
        rows: resObj.rows || [],
        fields: resObj.fields ? resObj.fields.map(f => ({ name: f.name, dataType: f.dataTypeID })) : []
      };
    });

    res.json({
      success: true,
      results: formattedResults,
      duration: `${duration}ms`
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    res.status(400).json({
      success: false,
      error: err.message,
      position: err.position, // line position of syntax error if available
      duration: `${duration}ms`
    });
  }
});

// Disconnect database client on server shutdown
process.on('SIGINT', async () => {
  await disconnectActiveClient();
  process.exit(0);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`SQL Pro backend running on port ${PORT}`);
});
