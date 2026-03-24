import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "outline" | "destructive";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const base = "font-medium rounded focus:outline-none transition-colors";
  const variants = {
    primary: "bg-blue-500 hover:bg-blue-600 text-white",
    secondary: "bg-gray-200 hover:bg-gray-300 text-black",
    ghost: "bg-transparent hover:bg-gray-100 text-blue-500",
    outline: "border border-gray-300 text-gray-700 hover:bg-gray-100",
    destructive: "bg-red-500 hover:bg-red-600 text-white",
  };
  const sizes = {
    sm: "py-1 px-3 text-sm",
    md: "py-2 px-4",
    lg: "py-3 px-6 text-lg",
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
