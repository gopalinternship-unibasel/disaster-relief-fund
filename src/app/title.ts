import { useEffect } from "react";

/** Sets the browser tab's title for the page, so tabs, history and screen readers tell pages apart. */
export function usePageTitle(page: string) {
  useEffect(() => {
    document.title = page ? `${page} | Disaster Relief Fund` : "Disaster Relief Fund";
  }, [page]);
}
