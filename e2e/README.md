# Kapture E2E Tests

This directory contains end-to-end tests for the Kapture MCP Browser Automation extension.

## Setup

1. Install dependencies:
   ```bash
   cd e2e
   npm install
   ```

2. Build the server (if not already built):
   ```bash
   cd ../server
   npm run build
   ```

3. Make sure the Kapture extension is installed in your system's default browser (or the one you pass to `new_tab`). The framework opens and connects its own test tab via the `new_tab` tool — you do not need to open a tab or the test page yourself.

## Running Tests

Run all tests:
```bash
npm test
```

Run a specific test file:
```bash
npm test test/basic.test.js
```

## Test Structure

- `test-framework.js` - Core framework that handles:
  - Starting/stopping the server
  - Creating MCP client connections
  - Helper methods for tool calls and resource reads

- `test/` directory - Contains test files:
  - `basic.test.js` - Basic functionality tests (resources, tools, tabs)

## Adding New Tests

1. Create a new test file in the `test/` directory
2. Import the test framework:
   ```javascript
   import { TestFramework } from '../test-framework.js';
   ```
3. Use the framework methods to interact with Kapture

## Notes

- The framework will check if a server is already running before starting a new one
- Tests require the Kapture extension installed in the browser `new_tab` launches; the framework opens its own test tab and navigates it to the test page — no manual tab needed
- The test page (test.html) includes various elements for testing all tools