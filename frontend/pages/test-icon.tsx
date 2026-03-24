import { EnvelopeIcon } from "@heroicons/react/24/outline";

export default function TestIcon() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="relative">
<span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">
  <div className="w-5 h-5">
    <EnvelopeIcon className="w-full h-full" />
  </div>
</span>
        <input
          type="email"
          className="w-64 border p-2 pl-10 rounded"
          placeholder="you@example.com"
        />
      </div>
    </div>
  );
}

