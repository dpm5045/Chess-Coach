"use client";

import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  {
    label: "Search",
    path: "/",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    label: "Games",
    pathPrefix: "/games",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    label: "Analysis",
    pathPrefix: "/analysis",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(item: (typeof NAV_ITEMS)[number]) {
    if ("path" in item && item.path) return pathname === item.path;
    if ("pathPrefix" in item && item.pathPrefix)
      return pathname.startsWith(item.pathPrefix);
    return false;
  }

  function handleClick(item: (typeof NAV_ITEMS)[number]) {
    if ("path" in item && item.path) {
      router.push(item.path);
    }
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-surface">
      <div className="mx-auto flex max-w-lg md:max-w-2xl items-center justify-around py-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <button
              key={item.label}
              onClick={() => handleClick(item)}
              className={`flex flex-col items-center gap-0.5 px-4 py-1 ${
                active ? "text-accent-blue" : "text-gray-500"
              }`}
            >
              {item.icon}
              <span className="text-xs">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
