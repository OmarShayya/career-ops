export const STATUS_COLORS: Record<string, string> = {
  Evaluated: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  Applied: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  Responded: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  Interview: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  Offer: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  Rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  Discarded: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  SKIP: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export const KANBAN_COLUMNS = ["Evaluated", "Applied", "Responded", "Interview", "Offer"] as const;
export const SOURCE_TYPES = ["greenhouse", "ashby", "lever", "custom"] as const;
