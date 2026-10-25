// Content and organization edits share one ordering clock. Viewing/importing does not.
export const modifiedAt = value => [value.contentUpdatedAt || value.updatedAt || value.createdAt || '', value.metadataUpdatedAt || ''].sort().at(-1);
// Lists describe conversation activity. Organization still participates in the
// separate modification clock used for sync/conflicts, but must not make old
// conversations look newly written after automatic naming on another device.
export const conversationAt = value => value.contentUpdatedAt || value.updatedAt || value.createdAt || '';
export function manualAt(value){
    const automatic=value.sessionAutomaticName||value.automaticName||value.transcriptionNaming||value.automaticUpdatedAt;
    const explicitlyManual=value.sessionNameOrigin==='manual'||value.nameOrigin==='manual'||value.transcriptionNameOrigin==='manual';
    const legacy=value.manualUpdatedAt===undefined&&(!automatic||explicitlyManual)?value.metadataUpdatedAt||'':'';
    return [conversationAt(value),value.manualUpdatedAt||legacy].sort().at(-1);
}
export const displayTime=(value,mode='manual')=>mode==='conversation'?conversationAt(value):mode==='automatic'?modifiedAt(value):manualAt(value);
export function editTimes(value,at,automatic=false){
    return {updatedAt:at,metadataUpdatedAt:at,manualUpdatedAt:automatic?manualAt(value):at,...(automatic?{automaticUpdatedAt:at}:{})};
}
export function nextModifiedAt(...values) {
    return new Date(Math.max(Date.now(), ...values.map(value => (Date.parse(modifiedAt(value)) || 0) + 1))).toISOString();
}
