import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { SessionProvider } from "./app/session";
import { routeTree } from "./routeTree.gen";

// Hash addresses (#/checks) work from a file opened by double-click, from any sub-folder of a
// static host, and from `npm start`, with no server settings. The hosted preview build keeps the
// address in memory, because its host passes only plain #names through.
const history = import.meta.env.MODE === "artifact" ? createMemoryHistory({ initialEntries: ["/"] }) : createHashHistory();
const router = createRouter({ routeTree, history, defaultPreload: false, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 0 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
