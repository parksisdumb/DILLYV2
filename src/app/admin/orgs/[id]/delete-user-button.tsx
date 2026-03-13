"use client";

export function DeleteUserButton({
  name,
}: {
  name: string;
}) {
  return (
    <button
      type="submit"
      className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-900/40 hover:text-red-300"
      onClick={(e) => {
        if (
          !confirm(
            `Delete ${name}? This removes their account entirely and cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      Delete
    </button>
  );
}
