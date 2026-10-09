package demo;

/** Named like a test, compiled as a test, but has no test methods: nothing runs. */
class GhostTest {
  String looksBusy() {
    return Greeter.greet("ghost");
  }
}
