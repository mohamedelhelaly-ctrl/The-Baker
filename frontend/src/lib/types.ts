// Mirrors backend/app/schemas. Keep in sync in the same pull request as the API change.
export type UserRole = "customer" | "staff" | "owner";

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
}

export interface ModuleAccess {
  read: boolean;
  write: boolean;
}

export interface Me extends User {
  permissions: Record<string, ModuleAccess>;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface MessageResponse {
  message: string;
}
