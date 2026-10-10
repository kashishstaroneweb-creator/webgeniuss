import { Injectable } from '@nestjs/common';
import { FullStackBlueprint } from '../entities/website.entity';

@Injectable()
export class AppPlannerService {
  createProductionCrmBlueprint(prompt: string, projectName: string): FullStackBlueprint {
    const normalizedName = projectName.trim() || 'Core CRM';
    const modules = [
      { key: 'dashboard', name: 'Dashboard', description: 'At-a-glance CRM performance and workload overview.', entityNames: [], pagePaths: ['/'] },
      { key: 'contacts', name: 'Contacts', description: 'People, emails, phones, titles, and company relationships.', entityNames: ['Contact'], pagePaths: ['/contacts'] },
      { key: 'companies', name: 'Companies', description: 'Organizations and account records.', entityNames: ['Company'], pagePaths: ['/companies'] },
      { key: 'deals', name: 'Deals', description: 'Lead and opportunity pipeline management.', entityNames: ['Deal'], pagePaths: ['/deals'] },
      { key: 'tasks', name: 'Tasks', description: 'Follow-up work tied to CRM records.', entityNames: ['Task'], pagePaths: ['/tasks'] },
      { key: 'notes', name: 'Notes', description: 'Owner-scoped notes linked to CRM activity.', entityNames: ['Note'], pagePaths: ['/notes'] },
    ];

    const entities: NonNullable<FullStackBlueprint['entities']> = [
      {
        name: 'Company',
        collection: 'companies',
        ownerScoped: true,
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'industry', type: 'string', required: false },
          { name: 'website', type: 'string', required: false },
          { name: 'status', type: 'enum', required: true, options: ['Prospect', 'Active', 'Inactive'] },
        ],
      },
      {
        name: 'Contact',
        collection: 'contacts',
        ownerScoped: true,
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'email', type: 'string', required: true },
          { name: 'phone', type: 'string', required: false },
          { name: 'title', type: 'string', required: false },
          { name: 'companyId', type: 'relation', required: false, relationTo: 'Company' },
        ],
      },
      {
        name: 'Deal',
        collection: 'deals',
        ownerScoped: true,
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'stage', type: 'enum', required: true, options: ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'] },
          { name: 'value', type: 'number', required: false },
          { name: 'companyId', type: 'relation', required: false, relationTo: 'Company' },
          { name: 'contactId', type: 'relation', required: false, relationTo: 'Contact' },
        ],
      },
      {
        name: 'Task',
        collection: 'tasks',
        ownerScoped: true,
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'dueDate', type: 'date', required: false },
          { name: 'status', type: 'enum', required: true, options: ['Open', 'Done'] },
          { name: 'relatedType', type: 'enum', required: false, options: ['Contact', 'Company', 'Deal'] },
          { name: 'relatedId', type: 'string', required: false },
        ],
      },
      {
        name: 'Note',
        collection: 'notes',
        ownerScoped: true,
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'body', type: 'string', required: false },
          { name: 'relatedType', type: 'enum', required: false, options: ['Contact', 'Company', 'Deal'] },
          { name: 'relatedId', type: 'string', required: false },
        ],
      },
    ];

    const api = [
      { method: 'GET' as const, path: '/api/dashboard', description: 'Summarize CRM counts, open tasks, pipeline value, and recent notes.', requestBody: [], responseShape: 'DashboardSummary' },
      ...entities.flatMap((entity) => [
        { method: 'GET' as const, path: `/api/${entity.collection}`, description: `List ${entity.collection} with optional search and filters.`, requestBody: [], responseShape: `${entity.name}[]` },
        { method: 'POST' as const, path: `/api/${entity.collection}`, description: `Create a ${entity.name}.`, requestBody: entity.fields.filter((field) => field.required).map(({ name, type, required }) => ({ name, type, required })), responseShape: entity.name },
        { method: 'PATCH' as const, path: `/api/${entity.collection}/:id`, description: `Update a ${entity.name}.`, requestBody: entity.fields.map(({ name, type, required }) => ({ name, type, required: false })), responseShape: entity.name },
        { method: 'DELETE' as const, path: `/api/${entity.collection}/:id`, description: `Delete a ${entity.name}.`, requestBody: [], responseShape: '{ ok: true }' },
      ]),
    ];

    return {
      blueprintVersion: 2,
      projectName: normalizedName,
      summary: `${normalizedName} is a hosted core CRM SaaS app generated from: ${prompt.slice(0, 500)}`,
      features: [
        'Authenticated core CRM workspace',
        'Contacts, companies, deals, tasks, and notes',
        'Owner-scoped records for every user',
        'Dashboard metrics, search, filters, create, update, and delete workflows',
      ],
      dataModels: entities.map((entity) => ({
        name: entity.name,
        fields: entity.fields
          .filter((field) => ['string', 'number', 'boolean'].includes(field.type))
          .map((field) => ({ name: field.name, type: field.type as 'string' | 'number' | 'boolean', required: field.required })),
      })),
      api,
      modules,
      entities,
      relations: [
        { from: 'Contact', to: 'Company', type: 'many-to-one', field: 'companyId' },
        { from: 'Deal', to: 'Company', type: 'many-to-one', field: 'companyId' },
        { from: 'Deal', to: 'Contact', type: 'many-to-one', field: 'contactId' },
      ],
      pages: [
        { path: '/', name: 'Dashboard', moduleKey: 'dashboard', purpose: 'Show counts, pipeline value, recent notes, and open tasks.', primaryApi: ['GET /api/dashboard'] },
        ...modules.filter((module) => module.key !== 'dashboard').map((module) => ({
          path: module.pagePaths[0],
          name: module.name,
          moduleKey: module.key,
          purpose: `Manage ${module.name.toLowerCase()} records.`,
          primaryApi: [`GET /api/${module.key}`, `POST /api/${module.key}`],
        })),
      ],
      navigation: modules.map((module) => ({ label: module.name, path: module.pagePaths[0], moduleKey: module.key })),
      dashboardWidgets: [
        { key: 'contacts', title: 'Contacts', metric: 'contactCount', sourceApi: '/api/dashboard' },
        { key: 'companies', title: 'Companies', metric: 'companyCount', sourceApi: '/api/dashboard' },
        { key: 'deals', title: 'Open Pipeline', metric: 'openDealValue', sourceApi: '/api/dashboard' },
        { key: 'tasks', title: 'Open Tasks', metric: 'openTaskCount', sourceApi: '/api/dashboard' },
      ],
      roles: [
        { name: 'Owner', description: 'Default authenticated owner of their own CRM data.', permissions: ['crm:read', 'crm:write', 'crm:delete'] },
      ],
    };
  }
}
