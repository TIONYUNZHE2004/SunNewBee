import { useState } from "react";
import { loadToken, saveToken } from "./manageApi";

/** Staff token kept in sessionStorage (tl.staffToken), shared by every management tab. */
export function useStaffToken(): [string, (v: string) => void] {
  const [token, setToken] = useState(loadToken);
  return [
    token,
    (v: string) => {
      setToken(v);
      saveToken(v);
    },
  ];
}
