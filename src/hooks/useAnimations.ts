import { createContext, useContext } from "react";

export const AnimationsContext = createContext(true);

export function useAnimations() {
  return useContext(AnimationsContext);
}
