"use client";

// Simple spinner component
export default function ToolSpinner() {
  return (
    <div className="flex items-center justify-center py-2 text-sm text-gray-500">
      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2"></div>
      Agent is working...
    </div>
  );
}
