import yaml from 'js-yaml';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load YAML files
const toolsYaml = fs.readFileSync(path.join(__dirname, 'tools.yaml'), 'utf8');
const resourcesYaml = fs.readFileSync(path.join(__dirname, 'resources.yaml'), 'utf8');

// Function to pre-process compact YAML format to standard JSON Schema
function preprocessToolDefinition(tool: any): ToolDefinition {
  // If tool already has inputSchema, it's in the old format
  if (tool.inputSchema) {
    return tool as ToolDefinition;
  }

  // Transform compact format to standard format
  const inputSchema: any = {
    type: 'object'
  };

  // Move properties if they exist
  if (tool.properties && Object.keys(tool.properties).length > 0) {
    inputSchema.properties = tool.properties;
  } else {
    // If no properties, set to empty object to indicate no parameters
    inputSchema.properties = {};
  }

  // Move required if it exists and is not empty
  if (tool.required && tool.required.length > 0) {
    inputSchema.required = tool.required;
  }

  // Move oneOf if it exists (e.g. selector or xpath required)
  if (tool.oneOf) {
    inputSchema.oneOf = tool.oneOf;
  }

  // Create the tool definition in standard format
  const toolDef: ToolDefinition = {
    name: tool.name,
    description: tool.description,
    inputSchema
  };
  
  // Add outputSchema if it exists
  if (tool.outputSchema) {
    toolDef.outputSchema = tool.outputSchema;
  }
  
  return toolDef;
}

// Parse YAML
const rawToolsConfig = yaml.load(toolsYaml) as { tools: Record<string, any> | any[] };

// Handle both array and object formats
let toolsConfig: { tools: ToolDefinition[] };
if (Array.isArray(rawToolsConfig.tools)) {
  // Legacy array format
  toolsConfig = {
    tools: rawToolsConfig.tools.map(preprocessToolDefinition)
  };
} else {
  // New object format
  const toolsArray: ToolDefinition[] = [];
  for (const [name, toolDef] of Object.entries(rawToolsConfig.tools)) {
    const toolWithName = { name, ...toolDef };
    toolsArray.push(preprocessToolDefinition(toolWithName));
  }
  toolsConfig = { tools: toolsArray };
}

const rawResourcesConfig = yaml.load(resourcesYaml) as {
  baseResources: Record<string, any> | any[];
  dynamicTabResources: Record<string, any> | any[];
};

// Process resources to handle both array and object formats
function processResources(resources: Record<string, any> | any[], isDynamic: boolean = false) {
  if (Array.isArray(resources)) {
    // Legacy array format
    return resources;
  }

  // New object format - convert to array with generated uri
  const resourcesArray: any[] = [];
  for (const [key, resource] of Object.entries(resources)) {
    const processedResource = {
      ...resource,
      key: isDynamic ? key : undefined,
      uri: isDynamic ? `kapture://tab/${key}` : `kapture://${key}`,
      mimeType: resource.mimeType || 'application/json'
    };
    resourcesArray.push(processedResource);
  }
  return resourcesArray;
}

const resourcesConfig = {
  baseResources: processResources(rawResourcesConfig.baseResources),
  dynamicTabResources: processResources(rawResourcesConfig.dynamicTabResources, true)
};

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  outputSchema?: any;
}

// Convert JSON Schema to Zod schema
function jsonSchemaToZod(schema: any): z.ZodType<any> {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }

  if (schema.type === 'object') {
    const shape: Record<string, z.ZodType<any>> = {};

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        let zodType = jsonSchemaToZod(propSchema as any);

        // Handle default values
        if ((propSchema as any).default !== undefined) {
          zodType = zodType.default((propSchema as any).default);
        }

        // Check if property is required
        if (!schema.required || !schema.required.includes(key)) {
          zodType = zodType.optional();
        }

        shape[key] = zodType;
      }
    }

    let objectSchema: any = z.object(shape);

    // Handle oneOf validation (e.g., selector or xpath required)
    if (schema.oneOf) {
      // For selector/xpath pattern
      const hasSelector = schema.oneOf.some((s: any) =>
        s.required && s.required.includes('selector')
      );
      const hasXpath = schema.oneOf.some((s: any) =>
        s.required && s.required.includes('xpath')
      );

      if (hasSelector && hasXpath) {
        objectSchema = objectSchema.refine(
          (data: any) => data.selector || data.xpath,
          { message: 'Either selector or xpath must be provided' }
        );
      }
    }

    return objectSchema;
  }

  if (schema.type === 'string') {
    let stringSchema = z.string();

    if (schema.description) {
      stringSchema = stringSchema.describe(schema.description);
    }

    if (schema.format === 'url') {
      stringSchema = stringSchema.url();
    }

    if (schema.enum) {
      return z.enum(schema.enum as [string, ...string[]]);
    }

    return stringSchema;
  }

  if (schema.type === 'number') {
    let numberSchema = z.number();

    if (schema.description) {
      numberSchema = numberSchema.describe(schema.description);
    }

    if (schema.minimum !== undefined) {
      numberSchema = numberSchema.min(schema.minimum);
    }

    if (schema.maximum !== undefined) {
      numberSchema = numberSchema.max(schema.maximum);
    }

    return numberSchema;
  }

  return z.any();
}

// Convert tools
const convertedTools: Record<string, any> = {};

for (const tool of toolsConfig.tools) {
  const zodSchema = jsonSchemaToZod(tool.inputSchema);

  convertedTools[`${tool.name}Tool`] = {
    name: tool.name,
    description: tool.description,
    inputSchema: zodSchema,
    jsonSchema: tool.inputSchema,  // Keep original JSON Schema for MCP
    outputSchema: tool.outputSchema  // Pass through if defined in YAML
  };
}

// Export individual tools
export const navigateTool = convertedTools.navigateTool;
export const goBackTool = convertedTools.backTool;
export const goForwardTool = convertedTools.forwardTool;
export const clickTool = convertedTools.clickTool;
export const hoverTool = convertedTools.hoverTool;
export const fillTool = convertedTools.fillTool;
export const selectTool = convertedTools.selectTool;
export const keypressTool = convertedTools.keypressTool;
export const screenshotTool = convertedTools.screenshotTool;
export const domTool = convertedTools.domTool;
export const elementsFromPointTool = convertedTools.elementsFromPointTool;
export const elementsTool = convertedTools.elementsTool;
export const listTabsTool = convertedTools.list_tabsTool;
export const tabDetailTool = convertedTools.tab_detailTool;
export const consoleLogsTool = convertedTools.console_logsTool;

// Export all tools array - dynamically from convertedTools, excluding evaluate
export const allTools = Object.values(convertedTools).filter(tool => tool && tool.name && tool.name !== 'evaluate');

// Export resources
export const baseResources = resourcesConfig.baseResources;
export const dynamicTabResourceTemplates = resourcesConfig.dynamicTabResources;

// Helper function to create dynamic resources for a specific tab
export function createTabResources(tabId: string, tabTitle: string): Map<string, any> {
  const resources = new Map<string, any>();

  for (const template of dynamicTabResourceTemplates) {
    const key = template.key.replace('{tabId}', tabId);
    const resource = {
      uri: template.uri.replace('{tabId}', tabId),
      name: template.name.replace('{tabTitle}', tabTitle).replace('{tabId}', tabId),
      description: template.description.replace('{tabTitle}', tabTitle).replace('{tabId}', tabId),
      mimeType: template.mimeType
    };
    resources.set(key, resource);
  }

  return resources;
}

