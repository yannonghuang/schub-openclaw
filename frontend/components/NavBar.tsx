import Link from "next/link";
import { useRouter } from "next/router";
import { useAuth } from "../context/AuthContext";
import { useState } from "react";

export default function NavBar() {
  const router = useRouter();
  const { user, signOut, isSystem } = useAuth();
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      window.location.href = "/signin";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return (
    <nav className="bg-white border-b shadow-sm px-6 py-3 flex items-center justify-between w-full">
      {/* Left links */}
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="text-gray-800 hover:text-blue-600 font-medium cursor-pointer"
        >
          Home
        </Link>

        {user && (
          <>
            <Link
              href="/messaging"
              className="text-gray-800 hover:text-blue-600 font-medium cursor-pointer"
            >
              Messaging
            </Link>

            {/* AI dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setAiOpen(true)}
              onMouseLeave={() => setAiOpen(false)}
            >
              <button
                className="text-gray-800 hover:text-blue-600 font-medium cursor-pointer flex items-center gap-1"
              >
                AI Agent
                <svg
                  className={`w-4 h-4 transform transition-transform duration-200 ${
                    aiOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Keep open while hovering submenu */}
              <div
                className={`absolute left-0 mt-2 w-48 bg-white border rounded-md shadow-lg z-10 transition-all duration-150 ${
                  aiOpen ? "opacity-100 visible" : "opacity-0 invisible"
                }`}
              >
                
                {!isSystem() && (
                  <Link
                    href="/agent"
                    className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                  >
                    AI Agent
                  </Link>
                )}

                {!isSystem() && (
                  <Link
                    href="/thread-manager"
                    className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                  >
                    Thread Management
                  </Link>
                )}

              </div>

            </div>

            {/* Audit dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setAuditOpen(true)}
              onMouseLeave={() => setAuditOpen(false)}
            >
              <button
                className="text-gray-800 hover:text-blue-600 font-medium cursor-pointer flex items-center gap-1"
              >
                Audit
                <svg
                  className={`w-4 h-4 transform transition-transform duration-200 ${
                    auditOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Keep open while hovering submenu */}
              <div
                className={`absolute left-0 mt-2 w-48 bg-white border rounded-md shadow-lg z-10 transition-all duration-150 ${
                  auditOpen ? "opacity-100 visible" : "opacity-0 invisible"
                }`}
              >                
                <Link
                  href="/traceability"
                  className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                >
                  Traceability
                </Link>

                <Link
                  href="/agent-dashboard"
                  className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                >
                  Agent Dashboard
                </Link>
              </div>
            </div>

            {/* Settings dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => setOpen(false)}
            >
              <button
                className="text-gray-800 hover:text-blue-600 font-medium cursor-pointer flex items-center gap-1"
              >
                Settings
                <svg
                  className={`w-4 h-4 transform transition-transform duration-200 ${
                    open ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Keep open while hovering submenu */}
              <div
                className={`absolute left-0 mt-2 w-48 bg-white border rounded-md shadow-lg z-10 transition-all duration-150 ${
                  open ? "opacity-100 visible" : "opacity-0 invisible"
                }`}
              >
                <Link
                  href="/user-manager"
                  className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                >
                  Users
                </Link>

                {isSystem() && (
                  <Link
                    href="/transportation"
                    className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                  >
                    Transportation
                  </Link>
                )}

              </div>

            </div>

            <a
              href="/agent-chat-ui/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-800 hover:text-blue-600 font-medium cursor-pointer"
            >
              Playground
            </a>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-6">
        {user ? (
          <>
            <span className="text-gray-600 whitespace-nowrap">
              {user?.business?.name}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-1 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition"
            >
              Logout
            </button>
          </>
        ) : (
          <Link
            href="/signin"
            className="px-4 py-1 rounded-md bg-blue-100 text-blue-700 hover:bg-blue-200 transition cursor-pointer"
          >
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
