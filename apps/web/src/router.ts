import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "settings" }
  | { name: "course"; id: number; tab: string; sub?: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "course" && Number(parts[1])) return { name: "course", id: Number(parts[1]), tab: parts[2] ?? "materials", sub: parts[3] };
  return { name: "home" };
}

export const href = {
  home: () => "#/",
  settings: () => "#/settings",
  course: (id: number, tab = "materials", sub?: string | number) => `#/course/${id}/${tab}${sub !== undefined ? `/${sub}` : ""}`,
};

export const go = (h: string) => {
  window.location.hash = h;
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
