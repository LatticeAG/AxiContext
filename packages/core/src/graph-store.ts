import type { GraphEdge, GraphNode } from "./types.js";

export class GraphStore {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();

  addNodes(nodes: GraphNode[]): void {
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
  }

  addEdges(edges: GraphEdge[]): void {
    for (const edge of edges) {
      const edgeKey = `${edge.from}|${edge.type}|${edge.to}`;
      this.edges.set(edgeKey, edge);
    }
  }

  getNodes(): GraphNode[] {
    return [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getEdges(): GraphEdge[] {
    return [...this.edges.values()].sort((a, b) => {
      const aKey = `${a.from}|${a.type}|${a.to}`;
      const bKey = `${b.from}|${b.type}|${b.to}`;
      return aKey.localeCompare(bKey);
    });
  }
}
