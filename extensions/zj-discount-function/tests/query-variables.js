// Resolves @include/@skip in an input query the way Shopify does at runtime, so the
// template's fixture validator (which ignores directives) checks the input shape
// Shopify would really send. Variables come from the discount's rule-config
// metafield (top-level keys), falling back to the query's declared defaults.
import { Kind, valueFromASTUntyped, visit } from "graphql";

export function inputVariables(queryAST, input) {
  const vars = {};
  for (const def of queryAST.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    for (const v of def.variableDefinitions ?? []) {
      if (v.defaultValue) vars[v.variable.name.value] = valueFromASTUntyped(v.defaultValue);
    }
  }
  const mf = input?.discount?.metafield?.jsonValue;
  if (mf && typeof mf === "object") Object.assign(vars, mf);
  return vars;
}

export function applyDirectives(queryAST, variables) {
  const evaluate = (arg) => (arg.kind === Kind.VARIABLE ? Boolean(variables[arg.name.value]) : valueFromASTUntyped(arg) === true);
  const resolved = visit(queryAST, {
    Field(node) {
      for (const d of node.directives ?? []) {
        const ifArg = d.arguments?.find((a) => a.name.value === "if");
        if (!ifArg) continue;
        const cond = evaluate(ifArg.value);
        if ((d.name.value === "include" && !cond) || (d.name.value === "skip" && cond)) return null;
      }
      // The condition is resolved, so the directive (and its variable use) goes away.
      return node.directives?.length ? { ...node, directives: [] } : undefined;
    },
  });
  // Drop variable definitions no longer referenced (e.g. collectionIds without lines),
  // as Shopify does when it resolves the query; GraphQL validation rejects unused ones.
  const used = new Set();
  visit(resolved, {
    VariableDefinition: () => false,
    Variable(node) {
      used.add(node.name.value);
    },
  });
  return visit(resolved, {
    VariableDefinition(node) {
      return used.has(node.variable.name.value) ? undefined : null;
    },
  });
}
