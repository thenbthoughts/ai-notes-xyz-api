export interface DefaultDateTimeIpAddress {
  createdAtUtc: Date | null;
  createdAtIpAddress: string;
  createdAtUserAgent: string;
  updatedAtUtc: Date | null;
  updatedAtIpAddress: string;
  updatedAtUserAgent: string;
}

// Returns a normalized DefaultDateTimeIpAddress object from any input (e.g., res.locals.actionDatetime)
export const normalizeDateTimeIpAddress = (
  input: any
): DefaultDateTimeIpAddress => {
  return {
    createdAtUtc: typeof input?.createdAtUtc === 'string' ? new Date(input.createdAtUtc) : null,
    createdAtIpAddress: typeof input?.createdAtIpAddress === 'string' ? input.createdAtIpAddress : '',
    createdAtUserAgent: typeof input?.createdAtUserAgent === 'string' ? input.createdAtUserAgent : '',
    updatedAtUtc: typeof input?.updatedAtUtc === 'string' ? new Date(input.updatedAtUtc) : null,
    updatedAtIpAddress: typeof input?.updatedAtIpAddress === 'string' ? input.updatedAtIpAddress : '',
    updatedAtUserAgent: typeof input?.updatedAtUserAgent === 'string' ? input.updatedAtUserAgent : '',
  };
};
