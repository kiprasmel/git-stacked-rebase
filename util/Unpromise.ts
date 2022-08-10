export type Unpromise<T> = T extends Promise<infer U> ? U : never;
export type UnpromiseFn<T> = T extends () => Promise<infer U> ? () => U : never;
