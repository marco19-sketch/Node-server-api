// server.js - Express server with MariaDB connection and middleware

import express from "express";
import mariadb from "mariadb";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();

// ============================================
// MIDDLEWARE SECTION - ALL PART OF THE SERVER
// ============================================

// 1. Logger Middleware - Logs every request
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n📨 [${timestamp}] ${req.method} ${req.url}`);
  console.log(`   Headers:`, req.headers["content-type"] || "no content-type");

  // Capture response status
  res.on("finish", () => {
    console.log(
      `📤 [${timestamp}] ${req.method} ${req.url} - ${res.statusCode}`,
    );
  });

  next();
});

// 2. CORS Middleware - Allows requests from different origins (like Postman)
app.use(
  cors({
    origin: "*", // In production, specify your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// 3. JSON Parser Middleware - Parses JSON request bodies
app.use(express.json());

// 4. URL Encoded Parser - Parses form data
app.use(express.urlencoded({ extended: true }));

// 5. Request Timer Middleware - Adds timing info
app.use((req, res, next) => {
  req.requestTime = Date.now();
  next();
});

// ============================================
// DATABASE CONNECTION POOL
// ============================================

// Create a connection pool (better than single connection)
const pool = mariadb.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "test",
  connectionLimit: 5,
  acquireTimeout: 30000,
});

// Test database connection on startup
async function testConnection() {
  let conn;
  try {
    conn = await pool.getConnection();
    console.log("✅ Connected to MariaDB successfully!");

    // Create table if it doesn't exist
    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        in_stock BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Products table ready");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1); // Exit if can't connect to DB
  } finally {
    if (conn) conn.release();
  }
}

// Call the test function
testConnection();

// ============================================
// DATABASE MIDDLEWARE - Adds db connection to request
// ============================================

// This middleware makes the database pool available in all routes
app.use((req, res, next) => {
  req.db = pool; // Attach DB pool to request object
  next();
});

// ============================================
// VALIDATION MIDDLEWARE
// ============================================

const validateProduct = (req, res, next) => {
  const { name, price, in_stock } = req.body;

  console.log("🔍 Validating product data...");

  const errors = [];

  // Check required fields
  if (!name) errors.push("Product name is required");
  if (name && name.length < 3)
    errors.push("Product name must be at least 3 characters");

  if (!price && price !== 0) errors.push("Price is required");
  if (price && isNaN(parseFloat(price))) errors.push("Price must be a number");
  if (price && parseFloat(price) < 0) errors.push("Price cannot be negative");

  // in_stock is optional, defaults to true

  if (errors.length > 0) {
    console.log("❌ Validation failed:", errors);
    return res.status(400).json({
      error: "Validation failed",
      details: errors,
    });
  }

  // Convert price to number if it came as string
  if (req.body.price) {
    req.body.price = parseFloat(req.body.price);
  }

  console.log("✅ Validation passed");
  next();
};

// ============================================
// AUTHENTICATION MIDDLEWARE (Simple version)
// ============================================

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // For demo purposes, accept a simple token
  // In production, use JWT or proper authentication
  if (!authHeader || authHeader !== "Bearer my-secret-token") {
    console.log("🔒 Authentication failed: Invalid or missing token");
    return res.status(401).json({
      error: "Unauthorized",
      message: "Valid authorization token required",
    });
  }

  console.log("🔒 Authentication successful");
  next();
};

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

const errorHandler = (err, req, res, next) => {
  console.error("🔥 Error:", err.stack);

  // Handle different types of errors
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      error: "Duplicate entry",
      message: "A record with this information already exists",
    });
  }

  if (err.code === "ECONNREFUSED") {
    return res.status(503).json({
      error: "Database connection failed",
      message: "Unable to connect to database",
    });
  }

  // Default error response
  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
};

// ============================================
// ROUTES (with middleware chains)
// ============================================

// GET all products (public route - no auth needed)
app.get("/api/products", async (req, res, next) => {
  console.log("📦 Fetching all products...");

  let conn;
  try {
    conn = await req.db.getConnection();
    const rows = await conn.query(
      "SELECT * FROM products ORDER BY created_at DESC",
    );

    console.log(`✅ Found ${rows.length} products`);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
      responseTime: `${Date.now() - req.requestTime}ms`,
    });
  } catch (err) {
    next(err); // Pass to error handler
  } finally {
    if (conn) conn.release();
  }
});

// GET single product by ID
app.get("/api/products/:id", async (req, res, next) => {
  console.log(`📦 Fetching product ID: ${req.params.id}`);

  let conn;
  try {
    conn = await req.db.getConnection();
    const rows = await conn.query("SELECT * FROM products WHERE id = ?", [
      req.params.id,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Not found",
        message: `Product with ID ${req.params.id} not found`,
      });
    }

    console.log(`✅ Found product: ${rows[0].name}`);

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// CREATE product (protected route with validation)
app.post(
  "/api/products",
  authenticate, // First check auth
  validateProduct, // Then validate data
  async (req, res, next) => {
    console.log("📦 Creating new product:", req.body);

    let conn;
    try {
      conn = await req.db.getConnection();

      const result = await conn.query(
        "INSERT INTO products (name, price, in_stock) VALUES (?, ?, ?)",
        [
          req.body.name,
          req.body.price,
          req.body.in_stock !== undefined ? req.body.in_stock : true,
        ],
      );

      // Fetch the newly created product
      const newProduct = await conn.query(
        "SELECT * FROM products WHERE id = ?",
        [result.insertId],
      );

      console.log(`✅ Product created with ID: ${result.insertId}`);

      res.status(201).json({
        success: true,
        message: "Product created successfully",
        data: newProduct[0],
      });
    } catch (err) {
      next(err);
    } finally {
      if (conn) conn.release();
    }
  },
);

// UPDATE product
app.put(
  "/api/products/:id",
  authenticate,
  validateProduct,
  async (req, res, next) => {
    console.log(`📦 Updating product ID: ${req.params.id}`);

    let conn;
    try {
      conn = await req.db.getConnection();

      // Check if product exists
      const existing = await conn.query("SELECT * FROM products WHERE id = ?", [
        req.params.id,
      ]);

      if (existing.length === 0) {
        return res.status(404).json({
          error: "Not found",
          message: `Product with ID ${req.params.id} not found`,
        });
      }

      // Update product
      await conn.query(
        "UPDATE products SET name = ?, price = ?, in_stock = ? WHERE id = ?",
        [req.body.name, req.body.price, req.body.in_stock, req.params.id],
      );

      // Fetch updated product
      const updated = await conn.query("SELECT * FROM products WHERE id = ?", [
        req.params.id,
      ]);

      console.log(`✅ Product updated: ${req.params.id}`);

      res.json({
        success: true,
        message: "Product updated successfully",
        data: updated[0],
      });
    } catch (err) {
      next(err);
    } finally {
      if (conn) conn.release();
    }
  },
);

// DELETE product
app.delete("/api/products/:id", authenticate, async (req, res, next) => {
  console.log(`📦 Deleting product ID: ${req.params.id}`);

  let conn;
  try {
    conn = await req.db.getConnection();

    // Check if product exists
    const existing = await conn.query("SELECT * FROM products WHERE id = ?", [
      req.params.id,
    ]);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not found",
        message: `Product with ID ${req.params.id} not found`,
      });
    }

    // Delete product
    await conn.query("DELETE FROM products WHERE id = ?", [req.params.id]);

    console.log(`✅ Product deleted: ${req.params.id}`);

    res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (err) {
    next(err);
  } finally {
    if (conn) conn.release();
  }
});

// Health check endpoint (no auth needed)
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: pool ? "connected" : "disconnected",
  });
});

// ============================================
// 404 Handler - Route not found
// ============================================

app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Cannot ${req.method} ${req.url}`,
  });
});

// ============================================
// Error handling middleware (must be last)
// ============================================

app.use(errorHandler);

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 Available endpoints:`);
  console.log(`   GET    /api/health     - Health check`);
  console.log(`   GET    /api/products   - Get all products`);
  console.log(`   GET    /api/products/:id - Get one product`);
  console.log(`   POST   /api/products   - Create product (auth required)`);
  console.log(`   PUT    /api/products/:id - Update product (auth required)`);
  console.log(`   DELETE /api/products/:id - Delete product (auth required)`);
  console.log(`\n🔑 Auth token: Bearer my-secret-token`);
  console.log(
    `📊 Database: MariaDB on ${process.env.DB_HOST || "localhost"}\n`,
  );
});
