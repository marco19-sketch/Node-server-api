// Import the Express.js framework - a minimal and flexible Node.js web application framework
// that provides a robust set of features for web and mobile applications
import express from "express";

// Create an Express application instance
// This 'app' object represents our web application and will be used to:
// - Define routes (endpoints) for handling HTTP requests
// - Configure middleware
// - Set up the server to listen for incoming connections
const app = express();

// Define a route handler for HTTP GET requests to the root path ("/")
// When someone visits the root URL of our application (e.g., http://localhost:3000/),
// this callback function will be executed
app.get("/", (req, res) => {
  // Send a plain text response back to the client (web browser, mobile app, etc.)
  // The client will display or process this "Hello world" message
  res.send("Hello world");
});

// Start the Express server and make it listen for incoming connections on port 3000
// Once the server starts, it will:
// - Listen for HTTP requests at http://localhost:3000
// - Remain running, waiting for requests indefinitely (until manually stopped)
// Note: Without calling this method, our application would exit immediately
// and wouldn't be able to receive any HTTP requests
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
