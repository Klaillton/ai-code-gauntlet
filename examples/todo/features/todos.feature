Feature: Manage todos
  As a user
  I want to capture and complete todos
  So that I can track work

  Background:
    Given the system has no todos

  @op:createTodo @happy
  Scenario: Create a todo from the UI
    When I open the todo board
    And I add a todo titled "Write Gherkin scenarios"
    Then I should see a todo titled "Write Gherkin scenarios"
    And the todo "Write Gherkin scenarios" is not completed

  @op:completeTodo @happy
  Scenario: Complete a todo from the UI
    Given a todo titled "Review OpenAPI contract" exists
    When I open the todo board
    And I complete the todo titled "Review OpenAPI contract"
    Then the todo "Review OpenAPI contract" is completed

  @op:createTodo @unhappy
  Scenario: Reject empty todo titles via API
    When I create a todo via the API with title "   "
    Then the API responds with status 400
    And the API error message is "Title is required"

  @op:createTodo @happy
  Scenario: Create a todo via the API
    When I create a todo via the API with title "Ship the gauntlet"
    Then the API responds with status 201
    And the API todo title is "Ship the gauntlet"
    And the API todo is not completed

  @op:listTodos @happy
  Scenario: List existing todos on the board
    Given a todo titled "Ship the gauntlet" exists
    When I open the todo board
    Then I should see a todo titled "Ship the gauntlet"

  @op:listTodos @edge
  Scenario: Empty board shows no todos
    When I open the todo board
    Then I should see no todos

  @op:completeTodo @unhappy
  Scenario: Completing an unknown todo via the API fails
    When I complete a todo via the API with id "00000000-0000-4000-8000-000000000000"
    Then the API responds with status 404
    And the API error message is "Todo not found: 00000000-0000-4000-8000-000000000000"
