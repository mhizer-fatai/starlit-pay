AI Coding Agent Rules

General Principles

- Always write production-quality code.
- Prioritize readability, maintainability, and simplicity over cleverness.
- Never sacrifice code quality for speed.
- Follow the existing project architecture and coding style.
- Do not generate unnecessary code.

File Organization

- Each file must have a single responsibility.
- Keep files small and focused. If a file becomes too large, split it into smaller modules.
- File names must clearly describe their purpose.
- Group related files into logical folders.
- Remove unused files, imports, and dead code.

Functions

- Every function should perform one clear task.
- Keep functions short whenever possible.
- Break complex logic into helper functions.
- Avoid deeply nested conditions.
- Reuse existing functions instead of duplicating logic.

Naming

- Use descriptive names for variables, functions, classes, and files.
- Avoid abbreviations unless they are widely understood.
- Names should explain intent without needing comments.

Comments

- Only write comments when they improve understanding.
- Comments should explain why code exists or what a block of code does—not describe every line.
- Do not leave outdated or misleading comments.
- Never use emojis in comments.

Code Style

- Keep formatting clean and consistent.
- Remove commented-out code before finishing.
- Remove debug code before completing a task.
- Keep imports organized.
- Never leave TODOs unless explicitly requested.

Error Handling

- Handle errors gracefully.
- Provide meaningful error messages.
- Never silently ignore exceptions.
- Validate inputs before processing.

Performance

- Avoid unnecessary computations.
- Reuse existing data where possible.
- Prefer efficient algorithms and data structures.
- Optimize only when necessary without reducing readability.

Security

- Never hardcode secrets, API keys, passwords, or tokens.
- Validate and sanitize user input.
- Follow secure authentication and authorization practices.
- Use environment variables for sensitive configuration.

Testing

- Ensure new code does not break existing functionality.
- Test edge cases.
- Handle invalid inputs gracefully.
- Verify functionality before considering the task complete.

Dependencies

- Do not introduce new libraries unless necessary.
- Prefer existing project dependencies.
- Explain why a new dependency is needed.

Refactoring

- Improve existing code instead of rewriting it unless required.
- Reduce duplication.
- Preserve existing functionality while improving structure.

Before Finishing

Always verify that:

- The code builds successfully.
- No syntax errors exist.
- No unused variables or imports remain.
- No duplicate logic exists.
- File names accurately reflect their purpose.
- Functions have a single responsibility.
- Code is clean, readable, and maintainable.
- No emojis appear anywhere in the code or comments.

When Unsure

- Ask for clarification instead of making assumptions.
- Explain trade-offs when multiple solutions exist.
- Choose the simplest solution that satisfies the requirements.