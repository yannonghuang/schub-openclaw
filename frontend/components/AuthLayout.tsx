import React from "react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        backgroundColor: "#f9fafb",
        padding: "1rem",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          backgroundColor: "white",
          padding: "2rem",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          boxSizing: "border-box", // critical!
          overflow: "hidden", // just in case
        }}
      >
        {children}
      </div>
      <style jsx>{`
        /* Make all inputs and form elements respect border-box */
        input,
        textarea,
        select,
        button,
        form {
          box-sizing: border-box;
        }

        /* Prevent input overflow */
        input {
          width: 100%;
          padding-left: 2.5rem; /* leave space for icon */
          padding-right: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 1rem;
        }

        /* Position the icon absolutely inside the relative parent */
        .input-wrapper {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          color: #9ca3af;
          width: 1.25rem;
          height: 1.25rem;
        }

        /* Error styles */
        .error {
          border-color: #f87171;
        }

        .error-text {
          color: #f87171;
          font-size: 0.875rem;
          margin-top: 0.25rem;
        }

        /* Button styles */
        button {
          width: 100%;
          background-color: #2563eb;
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 6px;
          border: none;
          font-weight: 600;
          cursor: pointer;
        }

        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
