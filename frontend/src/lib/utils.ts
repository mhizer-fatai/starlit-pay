import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const container = "mx-auto w-full max-w-[1710px] px-7 sm:px-12 lg:px-[104px]";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
