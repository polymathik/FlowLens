export function formatName(name: string): string {
  return name.trim().toLowerCase();
}

export const MAX_NAME_LENGTH = 100;

export const validateName = (name: string): boolean => {
  return name.length > 0 && name.length <= MAX_NAME_LENGTH;
};
