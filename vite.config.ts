import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];
export default defineConfig({
  // Containers without IPv6 cannot bind the framework default "::", so
  // DEV_HOST=127.0.0.1 overrides it; DEV_PORT lets E2E run beside a dev
  // server. Unset keeps the framework defaults.
  server: {
    ...(process.env.DEV_HOST ? { host: process.env.DEV_HOST } : {}),
    ...(process.env.DEV_PORT ? { port: Number(process.env.DEV_PORT), strictPort: true } : {}),
  },
  optimizeDeps: {
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/{Layout,Sidebar}.tsx",
      "app/components/chat/ChatRouteContent.tsx",
      "app/routes/{home,chat.$threadId}.tsx",
    ],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
    }),
  ],
});
