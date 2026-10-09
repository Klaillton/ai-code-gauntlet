package demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class BetaTest {
  @Test
  void greets() {
    assertEquals("hello dev", Beta.greet("dev"));
  }
}
