/** Result returned by form server actions and shown by <ActionForm>. */
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Bumped on every success so forms can reset themselves. */
  at?: number;
}

export const initialState: ActionState = {};
