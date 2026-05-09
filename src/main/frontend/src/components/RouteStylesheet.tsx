import { useInsertionEffect } from "react";

type RouteStylesheetProps = {
  href: string;
};

export function RouteStylesheet({ href }: RouteStylesheetProps) {
  useInsertionEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [href]);
  return null;
}
