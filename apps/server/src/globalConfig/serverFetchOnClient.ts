/** Advertise the server-only default for providers that upstream runs on the device. */
export const getServerFetchOnClientOverride = (provider: string): boolean | undefined => {
  switch (provider) {
    case 'lmstudio':
    case 'magpie':
    case 'ollama':
    case 'unsloth': {
      return false;
    }
    default: {
      return undefined;
    }
  }
};
