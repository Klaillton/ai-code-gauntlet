package demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** Fails if it runs; the pom's <includes> tries to hide it. */
class FailingTest {
  @Test
  void wouldFail() {
    assertEquals("hello nobody", Greeter.greet("dev"));
  }
}
