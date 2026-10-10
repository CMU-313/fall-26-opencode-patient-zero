
HTTP endpoints to call Label Service
Test cases were added in 3 different files:
1. HTTP endpoint tests
Tests the core functionality of the endpoints, making sure all CRUD operations are working and returning the correct HTTP response. Also includes some integration tests for testing consecutive operations.
cd packages/opencode && bun test test/server/httpapi-v2-label.test.ts

2. OpenAPI contract tests
Checks that the machine readable description of the API includes the new API routes (/api/label and /api/label/{labelID})
cd packages/opencode && bun test test/server/httpapi-public-openapi.test.ts

3. Schema tests
Tests for the labels schema in packages/schema
cd packages/schema && bun test test/contract-hygiene.test.ts

These tests are sufficient for ensuring that HTTP endpoints to call Label service works. Alongside adding unit tests for individual CRUD operations, integration tests for consecutive CRUD operations exist as well. The API routes and schema are also testing for further completeness.