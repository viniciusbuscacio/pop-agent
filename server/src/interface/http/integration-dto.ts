import type { ChatDTO, IntegrationActivityDTO, IntegrationTokenDTO, RestClientDTO } from '@pop-agent/shared';
import type { ChatSummary } from '../../domain/chat/chat.js';
import type { IntegrationActivity, IntegrationToken, RestClient } from '../../domain/integrations/integration.js';
export function integrationTokenDto(value: IntegrationToken): IntegrationTokenDTO {
  return {id:value.id,name:value.name,scopes:[...value.scopes],createdAt:value.createdAt,expiresAt:value.expiresAt,lastUsedAt:value.lastUsedAt,revokedAt:value.revokedAt};
}
export function restClientDto(value: RestClient): RestClientDTO {
  return {id:value.id,name:value.name,baseUrl:value.baseUrl,enabled:value.enabled,authHeader:value.authHeader,hasCredential:value.hasCredential,updatedAt:value.updatedAt,operations:value.operations.map(operation=>({id:operation.id,name:operation.name,method:operation.method,path:operation.path}))};
}
export function integrationActivityDto(value: IntegrationActivity): IntegrationActivityDTO {
  return {runId:value.runId,chatId:value.chatId,state:value.state,phase:value.phase,updatedAt:value.updatedAt,startedAt:value.startedAt,tool:value.tool===null?null:{name:value.tool.name,status:value.tool.status},messageId:value.messageId,queueId:value.queueId??null};
}
export function integrationChatDto(value: ChatSummary): ChatDTO {
  return {id:value.id,title:value.title,model:value.model,provider:value.provider,archived:value.archived,pinned:value.pinned,executionMode:value.executionMode??'normal',createdAt:value.createdAt,updatedAt:value.updatedAt,preview:value.preview};
}
