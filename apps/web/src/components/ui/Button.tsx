"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "ref"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-500 text-white hover:bg-primary-400 active:bg-primary-600 focus:ring-primary-500 shadow-glow",
  secondary:
    "bg-surface-700 text-surface-100 hover:bg-surface-600 active:bg-surface-800 focus:ring-surface-500 border border-surface-600",
  accent:
    "bg-accent-500 text-surface-950 hover:bg-accent-400 active:bg-accent-600 focus:ring-accent-500 shadow-glow-accent",
  ghost:
    "bg-transparent text-surface-300 hover:bg-surface-800 hover:text-surface-100 focus:ring-surface-500",
  danger:
    "bg-error text-white hover:bg-red-400 active:bg-red-600 focus:ring-red-500",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm rounded-lg",
  md: "px-4 py-2 text-sm rounded-xl",
  lg: "px-6 py-3 text-base rounded-xl",
};

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      className,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <motion.button
        ref={ref}
        whileHover={isDisabled ? {} : { scale: 1.02 }}
        whileTap={isDisabled ? {} : { scale: 0.98 }}
        className={cn(
          "inline-flex items-center justify-center gap-2 font-medium",
          "transition-colors duration-200",
          "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-950",
          variantStyles[variant],
          sizeStyles[size],
          isDisabled && "opacity-50 cursor-not-allowed",
          className
        )}
        disabled={isDisabled}
        {...(props as HTMLMotionProps<"button">)}
      >
        {isLoading ? (
          <svg
            className="animate-spin h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </motion.button>
    );
  }
);

Button.displayName = "Button";

