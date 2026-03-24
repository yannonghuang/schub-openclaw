import * as React from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

// Root dialog container
export const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => onOpenChange(false)} // click outside to close
    >
      <div
        className="bg-white rounded-lg shadow-lg w-11/12 max-w-3xl p-6 relative animate-fadeIn"
        onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
      >
        {children}
      </div>
    </div>
  );
};

// Dialog content section
export const DialogContent: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => (
  <div className={`max-h-[70vh] overflow-y-auto ${className}`}>{children}</div>
);

// Header section
export const DialogHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => <div className={`mb-4 border-b pb-2 ${className}`}>{children}</div>;

// Title text
export const DialogTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = "",
}) => <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>;
