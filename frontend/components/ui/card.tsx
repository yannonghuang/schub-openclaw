// src/components/ui/Card.tsx
import React from "react";

interface BaseProps {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<BaseProps> = ({ children, className = "" }) => {
  return (
    <div className={`bg-white shadow-md rounded-lg p-4 ${className}`}>
      {children}
    </div>
  );
};

export const CardHeader: React.FC<BaseProps> = ({ children, className = "" }) => {
  return <div className={`mb-2 border-b pb-2 ${className}`}>{children}</div>;
};

export const CardTitle: React.FC<BaseProps> = ({ children, className = "" }) => {
  return <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>;
};

export const CardContent: React.FC<BaseProps> = ({ children, className = "" }) => {
  return <div className={`space-y-2 ${className}`}>{children}</div>;
};
