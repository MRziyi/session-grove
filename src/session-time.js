// Content and organization edits share one ordering clock. Viewing/importing does not.
export const modifiedAt = value => [value.contentUpdatedAt || value.updatedAt || value.createdAt || '', value.metadataUpdatedAt || ''].sort().at(-1);
export function nextModifiedAt(...values) {
    return new Date(Math.max(Date.now(), ...values.map(value => (Date.parse(modifiedAt(value)) || 0) + 1))).toISOString();
}
