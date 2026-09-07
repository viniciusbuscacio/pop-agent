import { useNavigate } from 'react-router-dom';
import type { SkillDTO, TaskDTO, McpServerDTO, A2aAgentDTO } from '@pop-agent/shared';
import { t } from '../i18n';
import type { ContextAction } from '../ui/action-surface';
import { skillsService } from '../services/skills';
import { mcpService } from '../services/mcp';
import { a2aService } from '../services/a2a';
import { useSkillsStore, skillEnabled } from '../store/skills';
import { useMcpStore } from '../store/mcp';
import { useA2aStore } from '../store/a2a';
import { useTasksStore } from '../store/tasks';
import { useNotificationsStore } from '../store/notifications';

/** The same resource actions are used by sidebar and overview cards. */
export function useAgentContextActions() {
  const navigate=useNavigate();
  const edit=(path:string):ContextAction=>({id:'edit',label:t('common.edit'),run:()=>{void navigate(path);}});
  return {
    skill:(skill:SkillDTO):ContextAction[]=>[
      edit(`/skills/${encodeURIComponent(skill.slug)}`),
      {id:'toggle',label:t(skillEnabled(skill)?'context.disable':'context.enable'),run:async()=>{useSkillsStore.getState().upsertSkill(await skillsService.setEnabled(skill.slug,!skillEnabled(skill)));}},
      ...(skill.source==='builtin'?[]:[{id:'delete',label:t('skills.delete'),danger:true,run:async()=>{await skillsService.remove(skill.slug);await useSkillsStore.getState().reload();}}]),
    ],
    task:(task:TaskDTO):ContextAction[]=>[
      edit(`/tasks/${task.id}`),
      {id:'run',label:t('tasks.runNow'),run:()=>useTasksStore.getState().runNow(task.id)},
      {id:'toggle',label:t(task.enabled?'tasks.disable':'tasks.enable'),run:()=>useTasksStore.getState().toggle(task.id,!task.enabled)},
      {id:'delete',label:t('tasks.delete'),danger:true,run:async()=>{if(window.confirm(t('tasks.deleteConfirm',{title:task.title})))await useTasksStore.getState().remove(task.id);}},
    ],
    mcp:(server:McpServerDTO):ContextAction[]=>[
      edit(`/mcp/${server.id}`),
      {id:'toggle',label:t(server.enabled?'context.disable':'context.enable'),run:async()=>{await mcpService.toggle(server.id);await useMcpStore.getState().reload();}},
      {id:'test',label:t('context.test'),run:async()=>{const result=await mcpService.test(server.id);await useMcpStore.getState().reload();useNotificationsStore.getState().notify(`${server.name}: ${result.server.status}`);}},
      {id:'delete',label:t('shell.delete'),danger:true,run:async()=>{if(window.confirm(`Delete MCP server “${server.name}”?`)){await mcpService.remove(server.id);await useMcpStore.getState().reload();}}},
    ],
    a2a:(agent:A2aAgentDTO):ContextAction[]=>[
      edit(`/a2a/${agent.id}`),
      ...(agent.enabled ? [{id:'conversation',label:t('context.startConversation'),run:async()=>{
        const text=window.prompt(t('context.messagePrompt',{name:agent.name}));
        if (!text?.trim()) return;
        await a2aService.send(agent.id,text.trim());
        await useA2aStore.getState().loadTasks(agent.id);
        void navigate(`/a2a/${agent.id}`);
      }}] : []),
      {id:'toggle',label:t(agent.enabled?'context.disable':'context.enable'),run:()=>useA2aStore.getState().toggle(agent.id)},
      {id:'test',label:t('context.test'),run:async()=>{const result=await a2aService.test(agent.id);useA2aStore.getState().replaceAgent(result.agent);useNotificationsStore.getState().notify(`${agent.name}: ${result.agent.status}`);}},
      {id:'delete',label:t('shell.delete'),danger:true,run:async()=>{if(window.confirm(t('a2a.deleteConfirm',{name:agent.name})))await useA2aStore.getState().remove(agent.id);}},
    ],
  };
}
