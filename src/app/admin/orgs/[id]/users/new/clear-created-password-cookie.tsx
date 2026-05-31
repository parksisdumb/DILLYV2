"use client";

import { useEffect, useRef } from "react";

/**
 * Fires the server action that deletes the one-time `admin_created_password`
 * cookie. Cookies can't be mutated during a Server Component render, so the
 * success screen reads the value, renders this, and we clear it on mount.
 */
export default function ClearCreatedPasswordCookie({
  clear,
}: {
  clear: () => Promise<void>;
}) {
  const cleared = useRef(false);

  useEffect(() => {
    if (cleared.current) return;
    cleared.current = true;
    void clear();
  }, [clear]);

  return null;
}
