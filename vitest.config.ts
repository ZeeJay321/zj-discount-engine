import { defineConfig } from "vitest/config";

// App tests (services, form parsing, webhooks). Core and Function have their own configs.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
