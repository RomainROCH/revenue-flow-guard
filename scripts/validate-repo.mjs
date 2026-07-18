import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const TEST_EXTENSION = '.ts';

function normalizePath(value) {
  return path.resolve(value).toLowerCase();
}

function relativePath(root, value) {
  return path.relative(root, value).split(path.sep).join('/');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function requireFile(root, relativeFile) {
  const filePath = path.resolve(root, relativeFile);
  if (!(await fileExists(filePath))) {
    throw new Error(`Required file is missing: ${relativeFile}`);
  }
  return filePath;
}

async function listFiles(directory, predicate) {
  if (!(await fileExists(directory))) {
    return [];
  }

  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFiles(entryPath, predicate)));
    } else if (entry.isFile() && predicate(entryPath)) {
      results.push(entryPath);
    }
  }

  return results;
}

function parseSource(filePath, source) {
  const kind = filePath.endsWith('.ts')
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
}

function isExported(node) {
  return node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  ) ?? false;
}

function runtimeExportNames(sourceFile) {
  const names = [];

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.push(element.name.text);
      }
      continue;
    }

    if (!isExported(statement)) {
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement)
    ) {
      if (
        statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        )
      ) {
        names.push('default');
        continue;
      }
      if (statement.name) {
        names.push(statement.name.text);
        continue;
      }
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
        } else if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            if (ts.isIdentifier(element.name)) {
              names.push(element.name.text);
            }
          }
        } else if (ts.isArrayBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            if (element.name && ts.isIdentifier(element.name)) {
              names.push(element.name.text);
            }
          }
        }
      }
    }
  }

  return names;
}

async function resolveRelativeModule(importer, specifier, extensions) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base];

  if (!path.extname(base)) {
    for (const extension of extensions) {
      candidates.push(`${base}${extension}`);
      candidates.push(path.join(base, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function validateFixtureExports(root) {
  const testsRoot = path.join(root, 'tests');
  const fixturesRoot = path.join(testsRoot, 'fixtures');
  const fixtureFiles = await listFiles(
    fixturesRoot,
    (filePath) => path.extname(filePath) === TEST_EXTENSION,
  );
  const testFiles = await listFiles(
    testsRoot,
    (filePath) => path.extname(filePath) === TEST_EXTENSION,
  );
  const imports = new Map();

  for (const testFile of testFiles) {
    const source = await readFile(testFile, 'utf8');
    const sourceFile = parseSource(testFile, source);

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith('.') ||
        statement.importClause?.isTypeOnly
      ) {
        continue;
      }

      const target = await resolveRelativeModule(
        testFile,
        statement.moduleSpecifier.text,
        [TEST_EXTENSION],
      );
      if (!target || normalizePath(target) === normalizePath(testFile)) {
        continue;
      }

      const targetKey = normalizePath(target);
      const names = imports.get(targetKey) ?? new Set();

      if (statement.importClause?.name) {
        names.add('default');
      }

      if (
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        for (const element of statement.importClause.namedBindings.elements) {
          if (!element.isTypeOnly) {
            names.add((element.propertyName ?? element.name).text);
          }
        }
      }

      imports.set(targetKey, names);
    }
  }

  const diagnostics = [];
  for (const fixtureFile of fixtureFiles) {
    const source = await readFile(fixtureFile, 'utf8');
    const exportedNames = runtimeExportNames(parseSource(fixtureFile, source));
    const consumedNames = imports.get(normalizePath(fixtureFile)) ?? new Set();

    for (const name of exportedNames) {
      if (!consumedNames.has(name)) {
        diagnostics.push(
          `Unconsumed fixture export ${name}: ${relativePath(root, fixtureFile)}`,
        );
      }
    }
  }

  return diagnostics;
}

function shellTokens(command) {
  return command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|&&|\|\||[;&|]|[^\s;&|]+/g) ?? [];
}

function unquote(token) {
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function nodeTargets(command) {
  const tokens = shellTokens(command);
  const targets = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^node(?:\.exe)?$/i.test(unquote(tokens[index]))) {
      continue;
    }

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = unquote(tokens[cursor]);
      if (['&&', '||', ';', '&', '|'].includes(token)) {
        break;
      }
      if (['-e', '--eval', '-p', '--print'].includes(token)) {
        break;
      }
      if (token.startsWith('-')) {
        continue;
      }
      targets.push(token);
      break;
    }
  }

  return targets;
}

function extractRunCommands(source) {
  const commands = [];
  const lines = source.split('\n');
  let inBlock = false;
  let blockIndent = 0;

  for (const line of lines) {
    if (inBlock) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const indent = line.search(/\S/);
      if (indent <= blockIndent) {
        inBlock = false;
      } else {
        commands.push(line.trimEnd());
        continue;
      }
    }

    const match = line.match(/^\s*(?:- )?run:\s*(.*)$/);
    if (match) {
      const value = match[1].trim();
      if (value === '|' || value === '>-') {
        blockIndent = line.length - line.trimStart().length;
        inBlock = true;
      } else if (value) {
        commands.push(value);
      }
    }
  }

  return commands;
}

function relativeModuleSpecifiers(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.')
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.startsWith('.') &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

async function workflowNodeTargets(root) {
  const workflowFiles = await listFiles(
    path.join(root, '.github', 'workflows'),
    (filePath) => ['.yaml', '.yml'].includes(path.extname(filePath)),
  );
  const targets = [];

  for (const workflowFile of workflowFiles) {
    const source = await readFile(workflowFile, 'utf8');
    for (const command of extractRunCommands(source)) {
      targets.push(...nodeTargets(command));
    }
  }

  return targets;
}

async function validateScripts(root, packageJson) {
  const scriptsRoot = path.join(root, 'scripts');
  const scriptFiles = await listFiles(
    scriptsRoot,
    (filePath) => SCRIPT_EXTENSIONS.has(path.extname(filePath)),
  );
  const scriptByPath = new Map(
    scriptFiles.map((filePath) => [normalizePath(filePath), filePath]),
  );
  const packageTargets = Object.values(packageJson.scripts ?? {}).flatMap(
    (command) => (typeof command === 'string' ? nodeTargets(command) : []),
  );
  const workflowTargets = await workflowNodeTargets(root);
  const diagnostics = [];
  const entrypoints = [];

  for (const target of packageTargets) {
    const targetPath = path.resolve(root, target);
    if (!isInside(targetPath, root)) {
      diagnostics.push(`Package script target is outside the repository: ${target}`);
    } else if (!(await fileExists(targetPath))) {
      diagnostics.push(`Package script target is missing: ${target}`);
    } else if (scriptByPath.has(normalizePath(targetPath))) {
      entrypoints.push(targetPath);
    }
  }

  const GLOB_RE = /[*?[\]{}!]/;
  const workspaceDeclaration = packageJson.workspaces;
  if (Object.prototype.hasOwnProperty.call(packageJson, 'workspaces')) {
    let workspaceEntries;
    if (Array.isArray(workspaceDeclaration)) {
      workspaceEntries = workspaceDeclaration;
    } else if (
      typeof workspaceDeclaration === 'object' &&
      workspaceDeclaration !== null &&
      !Array.isArray(workspaceDeclaration) &&
      Array.isArray(workspaceDeclaration.packages)
    ) {
      workspaceEntries = workspaceDeclaration.packages;
    } else {
      diagnostics.push('Workspace declaration is invalid');
      workspaceEntries = [];
    }

    const canonicalRoot = await realpath(root);
    for (const entry of workspaceEntries) {
      if (typeof entry !== 'string') {
        diagnostics.push('Workspace entry must be a literal string');
        continue;
      }
      if (GLOB_RE.test(entry)) {
        diagnostics.push('Workspace entry contains glob metacharacters');
        continue;
      }
      const workspaceDir = path.resolve(root, entry);
      if (!isInside(workspaceDir, root)) {
        diagnostics.push('Workspace entry is outside the repository');
        continue;
      }
      if (normalizePath(workspaceDir) === normalizePath(root)) {
        diagnostics.push('Workspace entry is the repository root');
        continue;
      }

      let workspaceStat;
      let canonicalWorkspace;
      try {
        workspaceStat = await lstat(workspaceDir);
        canonicalWorkspace = await realpath(workspaceDir);
      } catch {
        diagnostics.push('Workspace package.json is missing or invalid');
        continue;
      }
      if (
        workspaceStat.isSymbolicLink() ||
        !workspaceStat.isDirectory() ||
        !isInside(canonicalWorkspace, canonicalRoot)
      ) {
        diagnostics.push('Workspace path is not a real repository directory');
        continue;
      }

      const workspacePackagePath = path.join(workspaceDir, 'package.json');
      let workspacePackageJson;
      try {
        const packageStat = await lstat(workspacePackagePath);
        const canonicalPackage = await realpath(workspacePackagePath);
        if (
          packageStat.isSymbolicLink() ||
          !packageStat.isFile() ||
          !isInside(canonicalPackage, canonicalWorkspace) ||
          !isInside(canonicalPackage, canonicalRoot)
        ) {
          throw new Error('invalid workspace package');
        }
        const content = await readFile(workspacePackagePath, 'utf8');
        workspacePackageJson = JSON.parse(content);
      } catch {
        diagnostics.push('Workspace package.json is missing or invalid');
        continue;
      }
      if (
        typeof workspacePackageJson !== 'object' ||
        workspacePackageJson === null ||
        Array.isArray(workspacePackageJson)
      ) {
        diagnostics.push('Workspace package.json must be an object');
        continue;
      }
      const workspaceTargets = Object.values(
        workspacePackageJson.scripts ?? {},
      ).flatMap(
        (command) =>
          typeof command === 'string' ? nodeTargets(command) : [],
      );
      for (const target of workspaceTargets) {
        const targetPath = path.resolve(workspaceDir, target);
        if (!isInside(targetPath, root)) {
          diagnostics.push(
            `Package script target is outside the repository: ${target}`,
          );
        } else if (!(await fileExists(targetPath))) {
          diagnostics.push(`Package script target is missing: ${target}`);
        } else if (scriptByPath.has(normalizePath(targetPath))) {
          entrypoints.push(targetPath);
        }
      }
    }
  }

  for (const target of workflowTargets) {
    const targetPath = path.resolve(root, target);
    if (!isInside(targetPath, root)) {
      diagnostics.push(`Workflow script target is outside the repository: ${target}`);
    } else if (!(await fileExists(targetPath))) {
      diagnostics.push(`Workflow script target is missing: ${target}`);
    } else if (scriptByPath.has(normalizePath(targetPath))) {
      entrypoints.push(targetPath);
    }
  }

  const dependencyGraph = new Map();
  for (const scriptFile of scriptFiles) {
    const source = await readFile(scriptFile, 'utf8');
    const sourceFile = parseSource(scriptFile, source);
    const dependencies = [];

    for (const specifier of relativeModuleSpecifiers(sourceFile)) {
      const dependency = await resolveRelativeModule(
        scriptFile,
        specifier,
        [...SCRIPT_EXTENSIONS],
      );
      if (!dependency) {
        diagnostics.push(
          `Unresolved script import ${specifier}: ${relativePath(root, scriptFile)}`,
        );
      } else if (scriptByPath.has(normalizePath(dependency))) {
        dependencies.push(dependency);
      }
    }

    dependencyGraph.set(normalizePath(scriptFile), dependencies);
  }

  const reachable = new Set();
  const pending = [...entrypoints];
  while (pending.length > 0) {
    const current = pending.pop();
    const key = normalizePath(current);
    if (reachable.has(key)) {
      continue;
    }
    reachable.add(key);
    pending.push(...(dependencyGraph.get(key) ?? []));
  }

  for (const scriptFile of scriptFiles) {
    if (!reachable.has(normalizePath(scriptFile))) {
      diagnostics.push(`Unreachable script: ${relativePath(root, scriptFile)}`);
    }
  }

  return diagnostics;
}

function objectStringProperty(object, propertyName) {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === propertyName) ||
        (ts.isStringLiteral(property.name) && property.name.text === propertyName)) &&
      (ts.isStringLiteral(property.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(property.initializer))
    ) {
      return property.initializer.text;
    }
  }
  return null;
}

function registeredRoutes(sourceFile) {
  const routes = [];
  const diagnostics = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createRouter' &&
      node.arguments.length > 0 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      for (const element of node.arguments[0].elements) {
        if (ts.isSpreadElement(element)) {
          diagnostics.push('createRouter array must not use spread elements');
          continue;
        }
        if (!ts.isObjectLiteralExpression(element)) {
          diagnostics.push('createRouter array must contain only route objects');
          continue;
        }
        const method = objectStringProperty(element, 'method');
        const routePath = objectStringProperty(element, 'path');
        if (method && routePath) {
          routes.push({ method, path: routePath });
        } else {
          diagnostics.push('createRouter route object must have literal method and path');
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { routes, diagnostics };
}

function findNonInlineCreateRouter(sourceFile) {
  const diagnostics = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createRouter' &&
      node.arguments.length > 0 &&
      !ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      diagnostics.push('createRouter must receive an inline array literal');
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return diagnostics;
}

async function resolvesToPlaywrightTest(filePath, bindingName, visited) {
  const key = `${normalizePath(filePath)}:${bindingName}`;
  if (visited.has(key)) {
    return false;
  }
  visited.add(key);

  const source = await readFile(filePath, 'utf8');
  const sourceFile = parseSource(filePath, source);

  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      !stmt.importClause?.isTypeOnly &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const element of stmt.importClause.namedBindings.elements) {
        if (!element.isTypeOnly && element.name.text === bindingName) {
          const moduleSpec = stmt.moduleSpecifier.text;
          if (moduleSpec === '@playwright/test') {
            const importedName = element.propertyName?.text ?? element.name.text;
            return importedName === 'test';
          }
          if (moduleSpec.startsWith('.')) {
            const remoteName = element.propertyName?.text ?? element.name.text;
            const modulePath = await resolveRelativeModule(filePath, moduleSpec, [TEST_EXTENSION, ...Array.from(SCRIPT_EXTENSIONS)]);
            if (modulePath) {
              return resolvesToPlaywrightTest(modulePath, remoteName, visited);
            }
          }
          return false;
        }
      }
    }
  }

  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
      if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const element of stmt.exportClause.elements) {
          if (element.name.text === bindingName) {
            const moduleSpec = stmt.moduleSpecifier.text;
            if (moduleSpec === '@playwright/test') {
              const reexportedName = element.propertyName?.text ?? element.name.text;
              return reexportedName === 'test';
            }
            if (moduleSpec.startsWith('.')) {
              const exportName = element.propertyName?.text ?? element.name.text;
              const modulePath = await resolveRelativeModule(filePath, moduleSpec, [TEST_EXTENSION, ...Array.from(SCRIPT_EXTENSIONS)]);
              if (modulePath && await resolvesToPlaywrightTest(modulePath, exportName, visited)) {
                return true;
              }
            }
            return false;
          }
        }
      }

      if (!stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const element of stmt.exportClause.elements) {
          if (element.name.text === bindingName) {
            const localName = element.propertyName?.text ?? element.name.text;
            if (localName !== bindingName) {
              return resolvesToPlaywrightTest(filePath, localName, visited);
            }
          }
        }
      }
    }

    if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === bindingName && decl.initializer) {
          if (
            ts.isCallExpression(decl.initializer) &&
            ts.isPropertyAccessExpression(decl.initializer.expression) &&
            decl.initializer.expression.name.text === 'extend' &&
            ts.isIdentifier(decl.initializer.expression.expression)
          ) {
            return resolvesToPlaywrightTest(filePath, decl.initializer.expression.expression.text, visited);
          }
          if (ts.isIdentifier(decl.initializer)) {
            return resolvesToPlaywrightTest(filePath, decl.initializer.text, visited);
          }
          return false;
        }
      }
    }
  }

  return false;
}

async function hasTestCall(filePath, sourceFile, title) {
  const visited = new Set();

  if (!(await resolvesToPlaywrightTest(filePath, 'test', visited))) {
    return false;
  }

  let found = false;

  function visit(node) {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'test' &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === title
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
}

function routeKey(route) {
  return `${route.method} ${route.path}`;
}

async function validateRoutes(root) {
  const applicationPath = await requireFile(root, 'src/create-application.js');
  const manifestPath = await requireFile(root, 'tests/meta/route-contracts.json');
  const applicationSource = await readFile(applicationPath, 'utf8');
  const applicationSourceFile = parseSource(applicationPath, applicationSource);
  const { routes: sourceRoutes, diagnostics: routeRegistrationDiags } = registeredRoutes(
    applicationSourceFile,
  );
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid route contract manifest: ${error.message}`);
  }

  if (
    !exactKeys(manifest, ['routes', 'schemaVersion']) ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.routes)
  ) {
    throw new Error('Invalid route contract manifest schema.');
  }

  const diagnostics = [
    ...findNonInlineCreateRouter(applicationSourceFile),
    ...routeRegistrationDiags,
  ];
  const sourceKeys = new Set();
  for (const route of sourceRoutes) {
    const key = routeKey(route);
    if (sourceKeys.has(key)) {
      diagnostics.push(`Duplicate registered route: ${key}`);
    }
    sourceKeys.add(key);
  }

  const manifestKeys = new Set();
  for (const route of manifest.routes) {
    if (
      !exactKeys(route, ['method', 'path', 'testFile', 'testTitle']) ||
      !['method', 'path', 'testFile', 'testTitle'].every(
        (key) => typeof route[key] === 'string' && route[key].length > 0,
      )
    ) {
      diagnostics.push('Invalid route contract entry.');
      continue;
    }

    const key = routeKey(route);
    if (manifestKeys.has(key)) {
      diagnostics.push(`Duplicate route contract: ${key}`);
    }
    manifestKeys.add(key);

    if (!route.testFile.endsWith('.spec.ts')) {
      diagnostics.push(`Route contract test file must be a Playwright spec for ${key}: ${route.testFile}`);
      continue;
    }

    const testsRoot = path.join(root, 'tests');
    const testPath = path.resolve(root, route.testFile);
    if (
      !isInside(testPath, testsRoot) ||
      !(await fileExists(testPath))
    ) {
      diagnostics.push(`Route contract test file is missing for ${key}: ${route.testFile}`);
      continue;
    }

    const testSource = await readFile(testPath, 'utf8');
    const testSourceFile = parseSource(testPath, testSource);
    if (!(await hasTestCall(testPath, testSourceFile, route.testTitle))) {
      diagnostics.push(`Route contract test title is missing for ${key}: ${route.testTitle}`);
    }
  }

  for (const key of sourceKeys) {
    if (!manifestKeys.has(key)) {
      diagnostics.push(`Registered route lacks a contract: ${key}`);
    }
  }
  for (const key of manifestKeys) {
    if (!sourceKeys.has(key)) {
      diagnostics.push(`Route contract has no registered route: ${key}`);
    }
  }

  return diagnostics;
}

function parseRoot(argumentsList) {
  if (argumentsList.length === 0) {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  }
  if (argumentsList.length === 2 && argumentsList[0] === '--root') {
    return path.resolve(argumentsList[1]);
  }
  throw new Error('Usage: node scripts/validate-repo.mjs [--root <absolute>]');
}

async function main() {
  const root = parseRoot(process.argv.slice(2));
  const packagePath = await requireFile(root, 'package.json');
  let packageJson;

  try {
    packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid package.json: ${error.message}`);
  }

  const diagnostics = [
    ...(await validateFixtureExports(root)),
    ...(await validateScripts(root, packageJson)),
    ...(await validateRoutes(root)),
  ].sort((left, right) => left.localeCompare(right));

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n'));
  }

  process.stdout.write('Repository structure validated.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
