/** A small but realistic OpenAPI 3 spec for the seeded demo tenant (Acme Analytics). */
export const SAMPLE_OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Acme Analytics API', version: '1.0.0' },
  servers: [{ url: 'mock://acme' }],
  paths: {
    '/account/status': {
      get: {
        operationId: 'get_account_status',
        summary: 'Get the current account status, plan, seats and renewal date',
        tags: ['account'],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/account/plan': {
      put: {
        operationId: 'update_plan',
        summary: 'Change the account plan',
        tags: ['billing'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { plan: { type: 'string', description: 'Target plan' } },
                required: ['plan'],
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/account/subscription': {
      delete: {
        operationId: 'cancel_subscription',
        summary: 'Cancel the subscription at the end of the current period',
        tags: ['billing'],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/reports/schedule': {
      post: {
        operationId: 'schedule_report',
        summary: 'Schedule a recurring report to a recipient',
        tags: ['reports'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  report: { type: 'string' },
                  recipient: { type: 'string' },
                  cadence: { type: 'string' },
                },
                required: ['report', 'recipient'],
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/resources/share': {
      post: {
        operationId: 'share_resource',
        summary: 'Share a resource with a team member',
        tags: ['collaboration'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  resource: { type: 'string' },
                  member: { type: 'string' },
                  access: { type: 'string' },
                },
                required: ['resource', 'member'],
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/invoices/latest': {
      get: {
        operationId: 'get_invoice',
        summary: 'Get the latest invoice',
        tags: ['billing'],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});
