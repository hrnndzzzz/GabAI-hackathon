class DomainError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def fail(status: int, code: str, message: str):
    raise DomainError(status, code, message)
