import { create } from "zustand";
import { loadToken, saveToken } from "./manageApi";

type TokenState = { token: string; setToken: (v: string) => void };

/** One shared staff token for every management tab, mirrored to sessionStorage (tl.staffToken). */
export const useStaffTokenStore = create<TokenState>((set) => ({
  token: loadToken(),
  setToken: (v) => {
    saveToken(v);
    set({ token: v });
  },
}));

export function useStaffToken(): [string, (v: string) => void] {
  const token = useStaffTokenStore((s) => s.token);
  const setToken = useStaffTokenStore((s) => s.setToken);
  return [token, setToken];
}
