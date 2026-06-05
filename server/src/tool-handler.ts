import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BrowserCommandHandler } from './browser-command-handler.js';
import { TabRegistry } from './tab-registry.js';
import { allTools } from './yaml-loader.js';
import { formatTabDetail } from './tab-utils.js';

export class ToolHandler {
  constructor(
    private commandHandler: BrowserCommandHandler,
    private tabRegistry: TabRegistry
  ) {}


  public getTools() {
    return allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool as any).jsonSchema || tool.inputSchema,
      outputSchema: (tool as any).outputSchema
    }));
  }

  public async callTool(name: string, args: any): Promise<any> {
    const tool = allTools.find(t => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      // For tools without arguments, use empty object
      const validatedArgs = tool.inputSchema.parse(args || {}) as any;

      // Check for invalid :contains() pseudo-selector
      if (validatedArgs.selector && validatedArgs.selector.includes(':contains(')) {
        throw new Error('The :contains() pseudo-selector is not valid CSS and is not supported by browsers. Use contains() selector with the `xpath` property instead!');
      }

      // Handle special cases that don't go through the command handler
      let result: any;
      switch (name) {
        case 'list_tabs':
          const tabs = this.tabRegistry.getAll().map(tab => formatTabDetail(tab));
          result = { tabs };
          if (tabs.length === 0) {
            result.hint = 'There currently are no tabs connected. Use the new_tab tool to create one!';
          }
          break;
        case 'tab_detail':
          const tab = this.tabRegistry.get(validatedArgs.tabId);
          if (!tab) {
            throw new Error(`Tab ${validatedArgs.tabId} not found`);
          }
          result = formatTabDetail(tab);
          break;
        case 'keypress':
          // Automatically adjust timeout based on delay
          if (validatedArgs.delay && !validatedArgs.timeout) {
            // Add 2 seconds to the delay for processing overhead
            validatedArgs.timeout = Math.max(5000, validatedArgs.delay + 2000);
          }
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
        default:
          // All other tools go through the generic callTool method
          result = await this.commandHandler.callTool(name, validatedArgs);
          break;
      }

      // Special handling for screenshot tool
      if (name === 'screenshot' && result.data) {
        const params = new URLSearchParams();
        const screenshotArgs = validatedArgs as any;
        if (screenshotArgs?.selector) params.append('selector', String(screenshotArgs.selector));
        if (screenshotArgs?.xpath) params.append('xpath', String(screenshotArgs.xpath));
        if (screenshotArgs?.scale) params.append('scale', String(screenshotArgs.scale));
        if (screenshotArgs?.format) params.append('format', String(screenshotArgs.format));
        if (screenshotArgs?.quality) params.append('quality', String(screenshotArgs.quality));

        const queryString = params.toString();
        const screenshotUrl = `http://127.0.0.1:61822/tab/${screenshotArgs?.tabId}/screenshot/view${queryString ? '?' + queryString : ''}`;

        const enhancedResult = {
          preview: screenshotUrl,
          ...result,
          // data goes in the image content
          data: undefined,
          dataUrl: undefined
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(enhancedResult, null, 2)
            },
            {
              type: 'image',
              mimeType: result.mimeType,
              data: result.data,
            },
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error: any) {
      if (error.name === 'ZodError') {
        const issues = error.issues.map((issue: any) => issue.message).join(', ');
        throw new McpError(ErrorCode.InvalidParams, issues);
      }
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({error: { message: error.message }}, null, 2)
          }
        ]
      };
    }
  }
}
